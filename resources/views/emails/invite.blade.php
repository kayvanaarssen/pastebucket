<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>You're invited to PasteBucket</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f5f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;color:#0f172a;-webkit-font-smoothing:antialiased;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f4f5f8;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:12px;box-shadow:0 1px 3px rgba(15,23,42,0.08);overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="padding:32px 40px 24px 40px;border-bottom:1px solid #e8eaf0;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="vertical-align:middle;padding-right:12px;">
                  <svg width="36" height="36" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10 18L13 40C13.2 41.7 14.6 43 16.3 43H31.7C33.4 43 34.8 41.7 35 40L38 18" fill="#4f6bed" fill-opacity="0.15" stroke="#4f6bed" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                    <rect x="7" y="14" width="34" height="5" rx="2.5" fill="#4f6bed"/>
                    <path d="M17 14V10C17 7.23858 19.2386 5 22 5H26C28.7614 5 31 7.23858 31 10V14" stroke="#4f6bed" stroke-width="2.5" stroke-linecap="round" fill="none"/>
                    <path d="M19 27L16 30.5L19 34" stroke="#4f6bed" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                    <path d="M29 27L32 30.5L29 34" stroke="#4f6bed" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                    <path d="M26 25L22 36" stroke="#4f6bed" stroke-width="2" stroke-linecap="round" fill="none"/>
                  </svg>
                </td>
                <td style="vertical-align:middle;">
                  <span style="font-size:20px;font-weight:700;color:#0f172a;letter-spacing:-0.01em;">PasteBucket</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px 8px 40px;">
            <h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.3;font-weight:700;color:#0f172a;">You're invited to PasteBucket</h1>
            <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#475569;">
              Hi there,
            </p>
            <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#475569;">
              <strong style="color:#0f172a;">{{ $inviterName }}</strong> has invited you to join
              <strong style="color:#0f172a;">PasteBucket</strong>, a self-hosted pastebin for sharing code and snippets.
              This invite was sent to <strong style="color:#0f172a;">{{ $email }}</strong>{!! $role === 'admin' ? ' and will create an <strong style="color:#0f172a;">administrator</strong> account' : '' !!}.
            </p>
            <p style="margin:0 0 28px 0;font-size:15px;line-height:1.6;color:#475569;">
              Click the button below to choose a password and activate your account. You can optionally add a passkey afterwards from your profile.
            </p>
          </td>
        </tr>

        <!-- CTA button -->
        <tr>
          <td align="center" style="padding:0 40px 28px 40px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="border-radius:8px;background-color:#4f6bed;">
                  <a href="{{ $url }}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Accept Invite</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Fallback link -->
        <tr>
          <td style="padding:0 40px 28px 40px;">
            <p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#64748b;">
              Or copy and paste this link into your browser:
            </p>
            <p style="margin:0;font-size:13px;line-height:1.5;word-break:break-all;">
              <a href="{{ $url }}" style="color:#4f6bed;text-decoration:none;">{{ $url }}</a>
            </p>
          </td>
        </tr>

        <!-- Expiry notice -->
        <tr>
          <td style="padding:0 40px 36px 40px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f4f5f8;border-radius:8px;">
              <tr>
                <td style="padding:14px 18px;font-size:13px;line-height:1.5;color:#64748b;">
                  This invite expires on <strong style="color:#0f172a;">{{ $expiresAt->format('F j, Y \a\t g:i A') }}</strong>. If it expires before you use it, ask the administrator for a new one.
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px 28px 40px;border-top:1px solid #e8eaf0;text-align:center;">
            <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">
              PasteBucket &middot; Self-hosted code sharing<br>
              &copy; {{ date('Y') }} @if(\App\Models\Setting::footerUrl())<a href="{{ \App\Models\Setting::footerUrl() }}" style="color:#94a3b8;text-decoration:none;">{{ \App\Models\Setting::footerCopyright() }}</a>@else{{ \App\Models\Setting::footerCopyright() }}@endif
            </p>
          </td>
        </tr>
      </table>

      <p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:#94a3b8;text-align:center;">
        If you weren't expecting this invite, you can safely ignore this email.
      </p>
    </td>
  </tr>
</table>
</body>
</html>
