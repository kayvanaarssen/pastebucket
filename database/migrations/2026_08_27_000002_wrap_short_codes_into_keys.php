<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * A short link has to be the whole link -- six characters, no fragment --
     * which means the code carries the content key rather than pointing at it.
     * The code becomes an auto-generated password: the browser wraps the CEK
     * under PBKDF2(code) and the server stores only the wrapped bytes.
     *
     * The plaintext code column goes with it. Storing the code next to the key
     * it unwraps would put both halves in the same dump and make the wrapping
     * decorative. What is stored instead is an HMAC of the code under APP_KEY,
     * which is enough to look a paste up and useless without the app key.
     */
    public function up(): void
    {
        Schema::table('pastes', function (Blueprint $table) {
            $table->string('short_code_hash', 64)->nullable()->unique()->after('slug');
            $table->json('short_meta')->nullable()->after('short_code_hash');
        });

        // Existing codes were minted as plaintext aliases. Carry them over so
        // links already handed out keep resolving; they have no wrapped key, so
        // they stay fragment-carrying aliases until re-minted.
        foreach (DB::table('pastes')->whereNotNull('short_code')->get(['id', 'short_code']) as $row) {
            DB::table('pastes')->where('id', $row->id)->update([
                'short_code_hash' => hash_hmac('sha256', $row->short_code, config('app.key')),
            ]);
        }

        Schema::table('pastes', function (Blueprint $table) {
            // The unique index has to go first -- SQLite refuses to drop a
            // column an index still references.
            $table->dropUnique('pastes_short_code_unique');
            $table->dropColumn('short_code');
        });
    }

    /**
     * Reverse the migrations.
     *
     * The plaintext codes are not recoverable from their HMACs, so rolling back
     * drops the short links rather than pretending to restore them.
     */
    public function down(): void
    {
        Schema::table('pastes', function (Blueprint $table) {
            $table->string('short_code', 16)->nullable()->unique()->after('slug');
            $table->dropColumn(['short_code_hash', 'short_meta']);
        });
    }
};
