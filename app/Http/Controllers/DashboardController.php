<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Inertia\Inertia;

class DashboardController extends Controller
{
    public function index(Request $request)
    {
        $pastes = $request->user()->pastes()
            ->orderBy('created_at', 'desc')
            ->paginate(20);

        return Inertia::render('Dashboard', [
            'pastes' => $pastes,
        ]);
    }
}
