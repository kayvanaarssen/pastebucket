<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Nullable on purpose: a short code is minted only when a paste's owner asks
     * for one. Handing every paste a 6-character handle would give the whole
     * table a second, far more guessable address than its 16-character slug.
     */
    public function up(): void
    {
        Schema::table('pastes', function (Blueprint $table) {
            $table->string('short_code', 16)->nullable()->unique()->after('slug');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('pastes', function (Blueprint $table) {
            $table->dropColumn('short_code');
        });
    }
};
