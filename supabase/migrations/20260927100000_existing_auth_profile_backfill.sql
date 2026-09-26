-- Auth accounts may predate installation of the profile creation trigger.
-- Populate missing public display profiles without touching Auth or role grants.
INSERT INTO public.profiles (user_id, display_name)
SELECT u.id,
       CASE WHEN char_length(btrim(COALESCE(u.raw_user_meta_data ->> 'display_name', ''))) BETWEEN 1 AND 80
            THEN btrim(u.raw_user_meta_data ->> 'display_name')
            ELSE '회원' END
FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;
