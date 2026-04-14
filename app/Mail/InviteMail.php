<?php

namespace App\Mail;

use App\Models\UserInvite;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class InviteMail extends Mailable
{
    use Queueable, SerializesModels;

    public string $url;
    public string $inviterName;

    public function __construct(public UserInvite $invite)
    {
        $this->url = url('/invite/' . $invite->token);
        $this->inviterName = $invite->inviter?->name ?? 'An administrator';
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            to: [$this->invite->email],
            subject: "You're invited to PasteBucket",
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.invite',
            with: [
                'url' => $this->url,
                'email' => $this->invite->email,
                'role' => $this->invite->role,
                'inviterName' => $this->inviterName,
                'expiresAt' => $this->invite->expires_at,
            ],
        );
    }
}
