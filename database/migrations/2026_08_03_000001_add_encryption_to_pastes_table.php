<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Both columns are nullable on purpose: rows created before end-to-end
     * encryption keep encryption_version = null and stay readable as plaintext
     * legacy pastes. The server cannot encrypt them retroactively without
     * holding a key, which is exactly what E2E rules out.
     */
    public function up(): void
    {
        Schema::table('pastes', function (Blueprint $table) {
            $table->unsignedTinyInteger('encryption_version')->nullable()->after('content');
            $table->json('encryption_meta')->nullable()->after('encryption_version');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('pastes', function (Blueprint $table) {
            $table->dropColumn(['encryption_version', 'encryption_meta']);
        });
    }
};
