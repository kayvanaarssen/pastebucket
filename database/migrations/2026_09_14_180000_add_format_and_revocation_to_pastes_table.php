<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Additive only, so the previous release keeps running against the new
     * schema during a deploy and a rollback loses nothing it relied on.
     *
     * content_format defaults to 'code', which is what every existing paste
     * already is -- the default describes old rows correctly without touching
     * their (encrypted) content. revoked_at is null for everything that exists.
     */
    public function up(): void
    {
        Schema::table('pastes', function (Blueprint $table) {
            $table->string('content_format', 20)->default('code')->after('content');
            $table->timestamp('revoked_at')->nullable()->after('expires_at');
            $table->string('created_via', 10)->default('web')->after('ip_address');

            // pastes:clean scans on expiry every hour.
            $table->index('expires_at');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('pastes', function (Blueprint $table) {
            $table->dropIndex(['expires_at']);
            $table->dropColumn(['content_format', 'revoked_at', 'created_via']);
        });
    }
};
