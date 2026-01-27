-- Football Squares Schema

-- Parties table
CREATE TABLE parties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(6) NOT NULL UNIQUE,
    host_pin VARCHAR(4) NOT NULL,
    square_price DECIMAL(10, 2) NOT NULL DEFAULT 1.00,
    split_q1 INTEGER NOT NULL DEFAULT 25 CHECK (split_q1 >= 0 AND split_q1 <= 100),
    split_q2 INTEGER NOT NULL DEFAULT 25 CHECK (split_q2 >= 0 AND split_q2 <= 100),
    split_q3 INTEGER NOT NULL DEFAULT 25 CHECK (split_q3 >= 0 AND split_q3 <= 100),
    split_final INTEGER NOT NULL DEFAULT 25 CHECK (split_final >= 0 AND split_final <= 100),
    status VARCHAR(20) NOT NULL DEFAULT 'filling' CHECK (status IN ('filling', 'locked', 'active', 'complete')),
    team_row_name VARCHAR(50) NOT NULL DEFAULT 'Seahawks',
    team_col_name VARCHAR(50) NOT NULL DEFAULT 'Patriots',
    team_row_color VARCHAR(7) NOT NULL DEFAULT '#69BE28',
    team_col_color VARCHAR(7) NOT NULL DEFAULT '#C60C30',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    CONSTRAINT split_total CHECK (split_q1 + split_q2 + split_q3 + split_final = 100)
);

-- Squares table
CREATE TABLE squares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    row_num INTEGER NOT NULL CHECK (row_num >= 0 AND row_num <= 9),
    col_num INTEGER NOT NULL CHECK (col_num >= 0 AND col_num <= 9),
    player_name VARCHAR(50),
    player_name_lower VARCHAR(50) GENERATED ALWAYS AS (LOWER(player_name)) STORED,
    claimed_at TIMESTAMPTZ,
    UNIQUE (party_id, row_num, col_num)
);

-- Numbers table (assigned after grid is locked)
CREATE TABLE numbers (
    party_id UUID PRIMARY KEY REFERENCES parties(id) ON DELETE CASCADE,
    row_numbers INTEGER[] NOT NULL CHECK (array_length(row_numbers, 1) = 10),
    col_numbers INTEGER[] NOT NULL CHECK (array_length(col_numbers, 1) = 10),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Scores table
CREATE TABLE scores (
    party_id UUID PRIMARY KEY REFERENCES parties(id) ON DELETE CASCADE,
    q1_row_score INTEGER,
    q1_col_score INTEGER,
    q2_row_score INTEGER,
    q2_col_score INTEGER,
    q3_row_score INTEGER,
    q3_col_score INTEGER,
    final_row_score INTEGER,
    final_col_score INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Winners table
CREATE TABLE winners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    quarter VARCHAR(10) NOT NULL CHECK (quarter IN ('q1', 'q2', 'q3', 'final')),
    winning_row INTEGER NOT NULL CHECK (winning_row >= 0 AND winning_row <= 9),
    winning_col INTEGER NOT NULL CHECK (winning_col >= 0 AND winning_col <= 9),
    player_name VARCHAR(50) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (party_id, quarter)
);

-- Heartbeat table for score fetcher monitoring
CREATE TABLE heartbeat (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    source VARCHAR(20) NOT NULL,
    last_beat TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert initial heartbeat row
INSERT INTO heartbeat (id, source, last_beat) VALUES (1, 'none', NOW() - INTERVAL '1 hour');

-- Indexes
CREATE INDEX idx_parties_code ON parties(code);
CREATE INDEX idx_parties_expires ON parties(expires_at);
CREATE INDEX idx_squares_party ON squares(party_id);
CREATE INDEX idx_squares_player ON squares(player_name_lower);
CREATE INDEX idx_winners_party ON winners(party_id);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER parties_updated_at
    BEFORE UPDATE ON parties
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER scores_updated_at
    BEFORE UPDATE ON scores
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- RPC: Claim a square
CREATE OR REPLACE FUNCTION claim_square(
    p_party_id UUID,
    p_row INTEGER,
    p_col INTEGER,
    p_player_name VARCHAR(50)
)
RETURNS BOOLEAN AS $$
DECLARE
    v_party_status VARCHAR(20);
    v_current_owner VARCHAR(50);
BEGIN
    -- Check party status
    SELECT status INTO v_party_status FROM parties WHERE id = p_party_id;
    IF v_party_status != 'filling' THEN
        RETURN FALSE;
    END IF;

    -- Check current owner
    SELECT player_name INTO v_current_owner
    FROM squares
    WHERE party_id = p_party_id AND row_num = p_row AND col_num = p_col;

    IF v_current_owner IS NOT NULL THEN
        RETURN FALSE;
    END IF;

    -- Claim the square
    UPDATE squares
    SET player_name = p_player_name, claimed_at = NOW()
    WHERE party_id = p_party_id AND row_num = p_row AND col_num = p_col;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- RPC: Unclaim a square
CREATE OR REPLACE FUNCTION unclaim_square(
    p_party_id UUID,
    p_row INTEGER,
    p_col INTEGER,
    p_player_name VARCHAR(50)
)
RETURNS BOOLEAN AS $$
DECLARE
    v_party_status VARCHAR(20);
    v_current_owner VARCHAR(50);
BEGIN
    -- Check party status
    SELECT status INTO v_party_status FROM parties WHERE id = p_party_id;
    IF v_party_status != 'filling' THEN
        RETURN FALSE;
    END IF;

    -- Check current owner matches
    SELECT player_name INTO v_current_owner
    FROM squares
    WHERE party_id = p_party_id AND row_num = p_row AND col_num = p_col;

    IF LOWER(v_current_owner) != LOWER(p_player_name) THEN
        RETURN FALSE;
    END IF;

    -- Unclaim the square
    UPDATE squares
    SET player_name = NULL, claimed_at = NULL
    WHERE party_id = p_party_id AND row_num = p_row AND col_num = p_col;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Enable Row Level Security
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE squares ENABLE ROW LEVEL SECURITY;
ALTER TABLE numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE winners ENABLE ROW LEVEL SECURITY;
ALTER TABLE heartbeat ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Parties
CREATE POLICY "Anyone can read parties" ON parties
    FOR SELECT USING (true);

CREATE POLICY "Anyone can create parties" ON parties
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Host can update own party" ON parties
    FOR UPDATE USING (true);

-- RLS Policies: Squares
CREATE POLICY "Anyone can read squares" ON squares
    FOR SELECT USING (true);

CREATE POLICY "Anyone can create squares" ON squares
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update squares" ON squares
    FOR UPDATE USING (true);

-- RLS Policies: Numbers
CREATE POLICY "Anyone can read numbers" ON numbers
    FOR SELECT USING (true);

CREATE POLICY "Anyone can create numbers" ON numbers
    FOR INSERT WITH CHECK (true);

-- RLS Policies: Scores
CREATE POLICY "Anyone can read scores" ON scores
    FOR SELECT USING (true);

CREATE POLICY "Anyone can create scores" ON scores
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update scores" ON scores
    FOR UPDATE USING (true);

-- RLS Policies: Winners
CREATE POLICY "Anyone can read winners" ON winners
    FOR SELECT USING (true);

CREATE POLICY "Anyone can create winners" ON winners
    FOR INSERT WITH CHECK (true);

-- RLS Policies: Heartbeat
CREATE POLICY "Anyone can read heartbeat" ON heartbeat
    FOR SELECT USING (true);

CREATE POLICY "Anyone can update heartbeat" ON heartbeat
    FOR UPDATE USING (true);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE parties;
ALTER PUBLICATION supabase_realtime ADD TABLE squares;
ALTER PUBLICATION supabase_realtime ADD TABLE numbers;
ALTER PUBLICATION supabase_realtime ADD TABLE scores;
ALTER PUBLICATION supabase_realtime ADD TABLE winners;
