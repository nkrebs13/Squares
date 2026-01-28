-- Add host_name_lower to parties for PIN-protected host name
ALTER TABLE parties ADD COLUMN host_name_lower VARCHAR(50);

-- Create index for efficient lookup
CREATE INDEX idx_parties_host_name ON parties(host_name_lower);

-- RPC to verify PIN (returns boolean only, doesn't expose PIN)
CREATE OR REPLACE FUNCTION verify_host_pin(
    p_party_code VARCHAR(6),
    p_pin VARCHAR(4)
) RETURNS BOOLEAN AS $$
DECLARE
    v_host_pin VARCHAR(4);
BEGIN
    SELECT host_pin INTO v_host_pin FROM parties WHERE code = p_party_code;
    RETURN v_host_pin = p_pin;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
