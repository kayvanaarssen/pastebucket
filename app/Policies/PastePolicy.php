<?php

namespace App\Policies;

use App\Models\Paste;
use App\Models\User;

class PastePolicy
{
    /**
     * Status and revocation are owner-only. Holding a share link grants reading,
     * never management: the link is handed to customers, the token is not.
     */
    public function manage(User $user, Paste $paste): bool
    {
        return $paste->user_id !== null && $user->id === $paste->user_id;
    }
}
