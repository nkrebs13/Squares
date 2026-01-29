# Football Squares

A real-time web application for managing Super Bowl betting pools. Create and join "squares" parties where participants claim grid squares and win payouts based on game scores.

## How It Works

1. **Create a party** - Set the price per square, choose a payout structure, and get a unique party code
2. **Share the code** - Invite friends to join using the party code
3. **Claim squares** - Participants click squares on the 10x10 grid to claim them
4. **Lock the grid** - Once full, the host locks the grid and random numbers (0-9) are assigned to rows and columns
5. **Track scores** - Enter scores for each quarter; winners are determined when game scores end in the assigned numbers
6. **Celebrate winners** - Payouts are distributed based on Q1, Q2, Q3, and Final scores

## Features

- Real-time grid synchronization across all participants
- Multiple payout structures (Rising, Equal, Big Finish, or Custom)
- Host PIN protection for administrative functions
- Player statistics and color-coded legend
- Pan and zoom for easy grid navigation
- PWA support - installable on mobile devices
- Recent parties saved locally for quick access
- Dark/light theme support

## Tech Stack

- **Frontend**: Svelte 5, SvelteKit, TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL with real-time subscriptions)
- **Deployment**: Cloudflare Pages

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd squares

# Install dependencies
npm install
```

### Environment Setup

Create a `.env.local` file in the project root:

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# For score fetcher (server-side only, optional)
SUPABASE_SERVICE_KEY=your-service-key-here
SUPER_BOWL_EVENT_ID=
```

### Database Setup

Run the migrations in the `supabase/migrations/` directory against your Supabase project in order (001 through 007).

### Development

```bash
# Start the development server
npm run dev

# Open in browser automatically
npm run dev -- --open
```

The app will be available at `http://localhost:5173`.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build locally |
| `npm run check` | Type-check TypeScript and Svelte files |
| `npm run lint` | Check code for linting errors |
| `npm run lint:fix` | Auto-fix linting issues |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check if code is formatted correctly |

## Project Structure

```
src/
├── routes/                 # SvelteKit pages
│   ├── +page.svelte       # Home (create/join party)
│   ├── create/            # Create party page
│   ├── join/              # Join party page
│   └── party/[code]/      # Game grid and admin panel
├── lib/
│   ├── components/        # Reusable Svelte components
│   ├── stores/            # State management
│   ├── types.ts           # TypeScript definitions
│   └── supabase.ts        # Supabase client
supabase/
└── migrations/            # Database schema and RPC functions
```

## Usage

### Creating a Party

1. Click "Create Party" on the home page
2. Set the price per square
3. Choose a payout structure
4. Enter your name (you'll be the host)
5. Set a 4-digit PIN for host functions
6. Share the generated party code with friends

### Joining a Party

1. Enter the party code on the home page, or use a direct link
2. Enter your name
3. Click squares on the grid to claim them

### Host Functions

Access the admin panel by clicking "Admin" (requires PIN):

- Lock the grid to start the game
- Enter scores for each quarter
- Modify payout structure
- Remove players from squares
- Delete the party

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run check` and `npm run lint` to ensure code quality
5. Submit a pull request
