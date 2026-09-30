ALTER TABLE public.restaurants
    ADD COLUMN IF NOT EXISTS location_consent_version text,
    ADD COLUMN IF NOT EXISTS location_consent_at timestamptz;

-- Location writes must pass through the consented, server-only RPC.
REVOKE INSERT (address, latitude, longitude), UPDATE (address, latitude, longitude)
    ON TABLE public.restaurants FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'public.restaurants'::regclass
          AND constraint_row.conname = 'ck_restaurants_location_consent_pair'
    ) THEN
        ALTER TABLE public.restaurants
            ADD CONSTRAINT ck_restaurants_location_consent_pair
            CHECK ((location_consent_version IS NULL) = (location_consent_at IS NULL));
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'public.restaurants'::regclass
          AND constraint_row.conname = 'ck_restaurants_consented_location_has_coordinates'
    ) THEN
        ALTER TABLE public.restaurants
            ADD CONSTRAINT ck_restaurants_consented_location_has_coordinates
            CHECK (location_consent_at IS NULL OR (latitude IS NOT NULL AND longitude IS NOT NULL));
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_can_set_restaurant_location(p_restaurant_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'signed-in restaurant owner required' USING ERRCODE = '42501';
    END IF;
    IF p_restaurant_id IS NULL OR p_restaurant_id < 1 THEN
        RETURN false;
    END IF;
    IF NOT private.owns_restaurant(p_restaurant_id) THEN
        RAISE EXCEPTION 'assigned restaurant owner required' USING ERRCODE = '42501';
    END IF;
    RETURN EXISTS (
        SELECT 1
        FROM public.restaurants AS restaurant_row
        WHERE restaurant_row.id = p_restaurant_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.owner_can_set_restaurant_location(bigint)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_can_set_restaurant_location(bigint)
    TO authenticated;

-- Remove the first G1 overload if it exists in a local database. It allowed
-- authenticated PostgREST callers to provide arbitrary coordinates directly.
DROP FUNCTION IF EXISTS public.owner_set_restaurant_location(bigint, text, numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.server_set_restaurant_location(
    p_restaurant_id bigint,
    p_owner_id uuid,
    p_address text,
    p_latitude numeric,
    p_longitude numeric,
    p_consent_version text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'server credential required' USING ERRCODE = '42501';
    END IF;
    IF p_restaurant_id IS NULL OR p_restaurant_id < 1
       OR p_owner_id IS NULL
       OR p_address IS NULL OR pg_catalog.btrim(p_address) = ''
       OR pg_catalog.char_length(pg_catalog.btrim(p_address)) > 240
       OR p_latitude IS NULL OR p_longitude IS NULL
       OR p_latitude < -90 OR p_latitude > 90
       OR p_longitude < -180 OR p_longitude > 180 THEN
        RAISE EXCEPTION 'valid restaurant address and coordinates required' USING ERRCODE = '22023';
    END IF;
    IF p_consent_version IS DISTINCT FROM 'restaurant-location-v1' THEN
        RAISE EXCEPTION 'current location consent required' USING ERRCODE = '22023';
    END IF;
    -- Hold the assignment row lock through the restaurant UPDATE. Assignment
    -- deletion then waits for an authorized write, while a deletion that
    -- commits first makes this final ownership check fail.
    PERFORM 1
    FROM private.restaurant_owners AS owner_row
    WHERE owner_row.restaurant_id = p_restaurant_id
      AND owner_row.user_id = p_owner_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'assigned restaurant owner required' USING ERRCODE = '42501';
    END IF;

    UPDATE public.restaurants
    SET address = pg_catalog.btrim(p_address),
        latitude = p_latitude,
        longitude = p_longitude,
        location_consent_version = p_consent_version,
        location_consent_at = pg_catalog.clock_timestamp()
    WHERE id = p_restaurant_id;

    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.server_set_restaurant_location(bigint, uuid, text, numeric, numeric, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.server_set_restaurant_location(bigint, uuid, text, numeric, numeric, text)
    TO service_role;
