#!/bin/bash
# Quick Start Script for PulseInbox Development

set -e

echo "🚀 PulseInbox Quick Start"
echo "========================"

# Check prerequisites
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 18+"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm not found. Please install npm"
    exit 1
fi

echo "✅ Node.js $(node --version)"
echo "✅ npm $(npm --version)"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Check for .env.local
if [ ! -f .env.local ]; then
    echo ""
    echo "⚠️  .env.local not found. Creating from template..."
    if [ -f .env.example ]; then
        cp .env.example .env.local
        echo "📝 Please edit .env.local with your Supabase credentials:"
        echo "   - VITE_SUPABASE_URL"
        echo "   - VITE_SUPABASE_ANON_KEY"
        echo "   - VITE_SUPABASE_STORAGE_BUCKET"
    else
        echo "📝 Create .env.local with:"
        cat > .env.local << 'EOF'
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_SUPABASE_STORAGE_BUCKET=attachments
EOF
    fi
    echo ""
    echo "⚠️  Setup your Supabase credentials in .env.local"
    exit 1
fi

echo "✅ .env.local found"

# Check Supabase CLI
echo ""
if command -v supabase &> /dev/null; then
    echo "✅ Supabase CLI installed"
    echo ""
    echo "Starting development servers..."
    echo ""
    echo "📝 Commands:"
    echo "  - npm run dev              : Start frontend dev server"
    echo "  - supabase start           : Start local Supabase"
    echo "  - supabase functions serve : Serve Edge Functions locally"
    echo ""
    echo "ℹ️  For local development:"
    echo "  1. In terminal 1: supabase start"
    echo "  2. In terminal 2: supabase functions serve"
    echo "  3. In terminal 3: npm run dev"
else
    echo "ℹ️  Supabase CLI not installed (optional for local dev)"
    echo "   Install with: npm install -g supabase"
fi

echo ""
echo "🎉 Ready to develop!"
echo ""
echo "Next steps:"
echo "  1. Edit .env.local with your Supabase credentials"
echo "  2. Run: npm run dev"
echo "  3. Open http://localhost:5173"
echo ""
echo "Documentation:"
echo "  - Setup Guide: ./SETUP.md"
echo "  - Deployment: ./DEPLOYMENT.md"
echo "  - Testing: ./TESTING.md"
echo "  - Migration Status: ./MIGRATION_STATUS.md"
