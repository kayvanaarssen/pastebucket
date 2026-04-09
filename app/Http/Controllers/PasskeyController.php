<?php

namespace App\Http\Controllers;

use App\Models\Passkey;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

class PasskeyController extends Controller
{
    /**
     * Get registration options for creating a new passkey.
     */
    public function registerOptions(Request $request)
    {
        $user = $request->user();

        $existingCredentials = $user->passkeys->map(fn ($passkey) => [
            'id' => $passkey->credential_id,
            'type' => 'public-key',
            'transports' => $passkey->transports ?? [],
        ])->toArray();

        $challenge = random_bytes(32);
        $request->session()->put('passkey_challenge', base64_encode($challenge));

        return response()->json([
            'challenge' => $this->base64urlEncode($challenge),
            'rp' => [
                'name' => config('app.name', 'PasteBucket'),
                'id' => parse_url(config('app.url'), PHP_URL_HOST),
            ],
            'user' => [
                'id' => $this->base64urlEncode($user->id . ''),
                'name' => $user->email,
                'displayName' => $user->name,
            ],
            'pubKeyCredParams' => [
                ['alg' => -7, 'type' => 'public-key'],   // ES256
                ['alg' => -257, 'type' => 'public-key'],  // RS256
            ],
            'excludeCredentials' => $existingCredentials,
            'authenticatorSelection' => [
                'authenticatorAttachment' => 'platform',
                'requireResidentKey' => true,
                'residentKey' => 'required',
                'userVerification' => 'required',
            ],
            'timeout' => 60000,
            'attestation' => 'none',
        ]);
    }

    /**
     * Store a new passkey credential.
     */
    public function register(Request $request)
    {
        $request->validate([
            'name' => 'required|string|max:255',
            'credential' => 'required|array',
            'credential.id' => 'required|string',
            'credential.rawId' => 'required|string',
            'credential.response.clientDataJSON' => 'required|string',
            'credential.response.attestationObject' => 'required|string',
            'credential.type' => 'required|string|in:public-key',
        ]);

        $challenge = $request->session()->pull('passkey_challenge');
        if (!$challenge) {
            return back()->withErrors(['error' => 'Challenge expired. Please try again.']);
        }

        $credential = $request->input('credential');
        $clientDataJSON = $this->base64urlDecode($credential['response']['clientDataJSON']);
        $clientData = json_decode($clientDataJSON, true);

        // Verify challenge
        $expectedChallenge = $this->base64urlEncode(base64_decode($challenge));
        if (!hash_equals($expectedChallenge, $clientData['challenge'])) {
            return back()->withErrors(['error' => 'Challenge verification failed.']);
        }

        // Verify origin
        $expectedOrigin = config('app.url');
        if ($clientData['origin'] !== $expectedOrigin) {
            return back()->withErrors(['error' => 'Origin verification failed.']);
        }

        // Verify type
        if ($clientData['type'] !== 'webauthn.create') {
            return back()->withErrors(['error' => 'Invalid ceremony type.']);
        }

        // Parse attestation object to extract public key
        $attestationObject = $this->base64urlDecode($credential['response']['attestationObject']);
        $authData = $this->parseAttestationObject($attestationObject);

        if (!$authData) {
            return back()->withErrors(['error' => 'Failed to parse attestation data.']);
        }

        // Store only what we need, with the algorithm identifier
        $coseKey = $authData['cose_key'] ?? [];
        $storedData = [
            'public_key_pem' => $authData['public_key_pem'],
            'algorithm' => $coseKey[3] ?? null,
        ];

        $request->user()->passkeys()->create([
            'name' => $request->input('name'),
            'credential_id' => $credential['id'],
            'public_key' => json_encode($storedData),
            'counter' => $authData['counter'] ?? 0,
            'transports' => $credential['transports'] ?? [],
        ]);

        return back()->with('success', 'Passkey registered successfully.');
    }

    /**
     * Get authentication options for signing in with a passkey.
     */
    public function authenticateOptions(Request $request)
    {
        $challenge = random_bytes(32);
        $request->session()->put('passkey_auth_challenge', base64_encode($challenge));

        return response()->json([
            'challenge' => $this->base64urlEncode($challenge),
            'rpId' => parse_url(config('app.url'), PHP_URL_HOST),
            'allowCredentials' => [],
            'userVerification' => 'required',
            'timeout' => 60000,
        ]);
    }

    /**
     * Authenticate with a passkey.
     */
    public function authenticate(Request $request)
    {
        $request->validate([
            'credential' => 'required|array',
            'credential.id' => 'required|string',
            'credential.response.clientDataJSON' => 'required|string',
            'credential.response.authenticatorData' => 'required|string',
            'credential.response.signature' => 'required|string',
            'credential.response.userHandle' => 'nullable|string',
        ]);

        $challenge = $request->session()->pull('passkey_auth_challenge');
        if (!$challenge) {
            return response()->json(['error' => 'Challenge expired.'], 422);
        }

        $credential = $request->input('credential');
        $clientDataJSON = $this->base64urlDecode($credential['response']['clientDataJSON']);
        $clientData = json_decode($clientDataJSON, true);

        // Verify challenge
        $expectedChallenge = $this->base64urlEncode(base64_decode($challenge));
        if (!hash_equals($expectedChallenge, $clientData['challenge'])) {
            return response()->json(['error' => 'Challenge verification failed.'], 422);
        }

        // Verify origin
        if ($clientData['origin'] !== config('app.url')) {
            return response()->json(['error' => 'Origin verification failed.'], 422);
        }

        // Find the passkey
        $passkey = Passkey::where('credential_id', $credential['id'])->first();
        if (!$passkey) {
            return response()->json(['error' => 'Passkey not found.'], 422);
        }

        // Verify authenticator data and update counter
        $authData = $this->base64urlDecode($credential['response']['authenticatorData']);
        $counter = unpack('N', substr($authData, 33, 4))[1];

        if ($counter > 0 && $counter <= $passkey->counter) {
            return response()->json(['error' => 'Possible cloned authenticator.'], 422);
        }

        // Verify signature
        $publicKeyData = json_decode($passkey->public_key, true);
        $authDataBinary = $this->base64urlDecode($credential['response']['authenticatorData']);
        $clientDataHash = hash('sha256', $clientDataJSON, true);
        $signedData = $authDataBinary . $clientDataHash;
        $signature = $this->base64urlDecode($credential['response']['signature']);

        if (!$this->verifySignature($publicKeyData, $signedData, $signature)) {
            return response()->json(['error' => 'Signature verification failed.'], 422);
        }

        // Update counter and last used
        $passkey->update([
            'counter' => $counter,
            'last_used_at' => now(),
        ]);

        // Log the user in
        Auth::login($passkey->user, true);
        $request->session()->regenerate();

        return response()->json(['redirect' => '/']);
    }

    /**
     * Delete a passkey.
     */
    public function destroy(Request $request, Passkey $passkey)
    {
        if ($passkey->user_id !== $request->user()->id) {
            abort(403);
        }

        $passkey->delete();
        return back()->with('success', 'Passkey removed.');
    }

    /**
     * List user's passkeys (for settings page).
     */
    public function index(Request $request)
    {
        return response()->json(
            $request->user()->passkeys()->select('id', 'name', 'last_used_at', 'created_at')->get()
        );
    }

    // --- Helper methods ---

    private function base64urlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private function base64urlDecode(string $data): string
    {
        return base64_decode(strtr($data, '-_', '+/') . str_repeat('=', (4 - strlen($data) % 4) % 4));
    }

    private function parseAttestationObject(string $attestationObject): ?array
    {
        // Simple CBOR parsing for attestation object
        // We need to extract authData which contains the public key
        $decoded = $this->cborDecode($attestationObject);
        if (!$decoded || !isset($decoded['authData'])) {
            return null;
        }

        $authData = $decoded['authData'];

        // Parse authData:
        // 32 bytes rpIdHash + 1 byte flags + 4 bytes counter + variable attestedCredentialData
        $offset = 0;
        $rpIdHash = substr($authData, $offset, 32); $offset += 32;
        $flags = ord($authData[$offset]); $offset += 1;
        $counter = unpack('N', substr($authData, $offset, 4))[1]; $offset += 4;

        // Check if attested credential data is present (bit 6)
        if (!($flags & 0x40)) {
            return null;
        }

        // AAGUID (16 bytes)
        $aaguid = substr($authData, $offset, 16); $offset += 16;

        // Credential ID length (2 bytes big-endian)
        $credIdLen = unpack('n', substr($authData, $offset, 2))[1]; $offset += 2;

        // Credential ID
        $credentialId = substr($authData, $offset, $credIdLen); $offset += $credIdLen;

        // Public key (CBOR-encoded COSE key)
        $publicKeyBytes = substr($authData, $offset);
        $coseKey = $this->cborDecode($publicKeyBytes);

        return [
            'counter' => $counter,
            'aaguid' => bin2hex($aaguid),
            'cose_key' => $coseKey,
            'public_key_pem' => $this->coseKeyToPem($coseKey),
        ];
    }

    private function coseKeyToPem(?array $coseKey): ?string
    {
        if (!$coseKey) return null;

        // Algorithm -7 (ES256 / P-256)
        if (isset($coseKey[3]) && $coseKey[3] === -7) {
            $x = $coseKey[-2] ?? null;
            $y = $coseKey[-3] ?? null;
            if (!$x || !$y) return null;

            // Create uncompressed EC point (0x04 || x || y)
            $point = "\x04" . $x . $y;

            // Wrap in SubjectPublicKeyInfo ASN.1 structure for P-256
            $der = "\x30\x59\x30\x13\x06\x07\x2a\x86\x48\xce\x3d\x02\x01\x06\x08\x2a\x86\x48\xce\x3d\x03\x01\x07\x03\x42\x00" . $point;

            return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
        }

        // Algorithm -257 (RS256)
        if (isset($coseKey[3]) && $coseKey[3] === -257) {
            $n = $coseKey[-1] ?? null;
            $e = $coseKey[-2] ?? null;
            if (!$n || !$e) return null;

            // Build RSA public key DER
            $nLen = strlen($n);
            $eLen = strlen($e);

            $nDer = $this->asn1Integer($n);
            $eDer = $this->asn1Integer($e);
            $seq = $this->asn1Sequence($nDer . $eDer);
            $bitString = "\x03" . $this->asn1Length(strlen($seq) + 1) . "\x00" . $seq;
            $algorithmId = "\x30\x0d\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01\x05\x00";
            $der = $this->asn1Sequence($algorithmId . $bitString);

            return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
        }

        return null;
    }

    private function asn1Integer(string $data): string
    {
        if (ord($data[0]) > 0x7f) {
            $data = "\x00" . $data;
        }
        return "\x02" . $this->asn1Length(strlen($data)) . $data;
    }

    private function asn1Sequence(string $data): string
    {
        return "\x30" . $this->asn1Length(strlen($data)) . $data;
    }

    private function asn1Length(int $length): string
    {
        if ($length < 0x80) {
            return chr($length);
        }
        $bytes = '';
        $temp = $length;
        while ($temp > 0) {
            $bytes = chr($temp & 0xff) . $bytes;
            $temp >>= 8;
        }
        return chr(0x80 | strlen($bytes)) . $bytes;
    }

    private function verifySignature(array $publicKeyData, string $signedData, string $signature): bool
    {
        $pem = $publicKeyData['public_key_pem'] ?? null;
        if (!$pem) return false;

        $publicKey = openssl_pkey_get_public($pem);
        if (!$publicKey) return false;

        $alg = $publicKeyData['algorithm'] ?? $publicKeyData['cose_key'][3] ?? null;

        if ($alg === -7) {
            // ES256 - need to convert from DER to raw signature format
            $derSig = $signature;
            $result = openssl_verify($signedData, $derSig, $publicKey, OPENSSL_ALGO_SHA256);
        } elseif ($alg === -257) {
            // RS256
            $result = openssl_verify($signedData, $signature, $publicKey, OPENSSL_ALGO_SHA256);
        } else {
            return false;
        }

        return $result === 1;
    }

    /**
     * Minimal CBOR decoder - handles the subset needed for WebAuthn.
     */
    private function cborDecode(string $data, int &$offset = 0): mixed
    {
        if ($offset >= strlen($data)) return null;

        $byte = ord($data[$offset]);
        $major = $byte >> 5;
        $additional = $byte & 0x1f;
        $offset++;

        $value = $this->cborDecodeValue($data, $offset, $additional);

        return match ($major) {
            0 => $value,                    // Unsigned integer
            1 => -1 - $value,               // Negative integer
            2 => substr($data, $offset, $value) . '' === '' ? '' : (function () use ($data, &$offset, $value) {
                $result = substr($data, $offset, $value);
                $offset += $value;
                return $result;
            })(),                           // Byte string
            3 => (function () use ($data, &$offset, $value) {
                $result = substr($data, $offset, $value);
                $offset += $value;
                return $result;
            })(),                           // Text string
            4 => (function () use ($data, &$offset, $value) {
                $arr = [];
                for ($i = 0; $i < $value; $i++) {
                    $arr[] = $this->cborDecode($data, $offset);
                }
                return $arr;
            })(),                           // Array
            5 => (function () use ($data, &$offset, $value) {
                $map = [];
                for ($i = 0; $i < $value; $i++) {
                    $key = $this->cborDecode($data, $offset);
                    $val = $this->cborDecode($data, $offset);
                    $map[$key] = $val;
                }
                return $map;
            })(),                           // Map
            default => null,
        };
    }

    private function cborDecodeValue(string $data, int &$offset, int $additional): int
    {
        if ($additional < 24) return $additional;
        if ($additional === 24) { $val = ord($data[$offset]); $offset++; return $val; }
        if ($additional === 25) { $val = unpack('n', substr($data, $offset, 2))[1]; $offset += 2; return $val; }
        if ($additional === 26) { $val = unpack('N', substr($data, $offset, 4))[1]; $offset += 4; return $val; }
        if ($additional === 27) {
            $hi = unpack('N', substr($data, $offset, 4))[1];
            $lo = unpack('N', substr($data, $offset + 4, 4))[1];
            $offset += 8;
            return ($hi << 32) | $lo;
        }
        return 0;
    }
}
