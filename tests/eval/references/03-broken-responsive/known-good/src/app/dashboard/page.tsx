"use client";

import { useState } from "react";

export default function Dashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <header data-testid="header" className="h-14 border-b flex items-center px-4 shrink-0">
        <button
          aria-label="Toggle menu"
          data-testid="mobile-menu-toggle"
          className="md:hidden mr-3"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          ☰
        </button>
        <h1 className="font-semibold">Dashboard</h1>
        <div className="ml-auto w-8 h-8 rounded-full bg-gray-300" />
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside
          data-testid="sidebar"
          className={`w-60 border-r bg-gray-50 shrink-0 ${sidebarOpen ? "block" : "hidden"} md:block`}
        >
          <nav className="p-4 space-y-2">
            <a href="#" className="block px-3 py-2 rounded hover:bg-gray-100">
              Home
            </a>
            <a href="#" className="block px-3 py-2 rounded hover:bg-gray-100">
              Settings
            </a>
          </nav>
        </aside>

        <main data-testid="content" className="flex-1 p-6 overflow-auto">
          <h2 className="text-xl font-semibold mb-4">Welcome</h2>
          <p>Dashboard content area.</p>
        </main>
      </div>
    </div>
  );
}
