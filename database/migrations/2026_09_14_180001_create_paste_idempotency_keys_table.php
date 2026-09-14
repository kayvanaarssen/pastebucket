<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * One row per Idempotency-Key a token user has sent. It outlives nothing:
     * the row expires with the paste it created, and until then a retry with the
     * same key and body gets that paste back instead of a second one.
     *
     * Only a hash of the request is kept -- the request is ciphertext anyway,
     * but there is no reason to store it twice.
     */
    public function up(): void
    {
        Schema::create('paste_idempotency_keys', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('key', 100);
            $table->char('request_hash', 64);
            $table->foreignId('paste_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamp('expires_at')->index();
            $table->timestamps();

            $table->unique(['user_id', 'key']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('paste_idempotency_keys');
    }
};
