-- Repair the greedy ZIP filename parser's last-comma split in place.
-- Facts are the approved user ZIP and V6 legacy seed; no menu or photo is deleted.
-- Correct rows are exact-skipped. Unexpected data fails closed for manual review.
DO $repair$
DECLARE
    v_restaurant_id bigint;
    v_count integer;
    v_before jsonb;
    v_after jsonb;
BEGIN
    SELECT id INTO v_restaurant_id FROM public.restaurants WHERE name = '곰포차 죽전점';
    IF v_restaurant_id IS NULL THEN RETURN; END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(20260927, 2);
    PERFORM 1 FROM public.menus WHERE restaurant_id = v_restaurant_id FOR UPDATE;
    PERFORM 1 FROM public.media_assets WHERE menu_id IN
        (SELECT id FROM public.menus WHERE restaurant_id = v_restaurant_id) FOR UPDATE;
    SELECT count(*) INTO v_count FROM public.menus WHERE restaurant_id = v_restaurant_id;
    IF v_count = 0 THEN RETURN; END IF;
    IF v_count <> 40 THEN RAISE EXCEPTION 'Gompocha repair requires the exact approved 40-menu catalog'; END IF;

    CREATE TEMP TABLE gompocha_expected_price_repair (name text PRIMARY KEY, price integer NOT NULL) ON COMMIT DROP;
    INSERT INTO gompocha_expected_price_repair (name, price) VALUES
        ('간장계란밥', 3900), ('곰라면', 3900), ('곰발파닭', 14900), ('곰포''s타코', 11900),
        ('김치항정파스탕', 17900), ('닭껍질튀김', 12900), ('닭연골튀김', 11900), ('대창모츠나베', 20900),
        ('돼지고기김치구이', 15900), ('뚝배기치즈떡볶이', 11900), ('모듬감자튀김', 10900), ('모짜렐라김치볶음밥', 14900),
        ('무뼈국물닭발+주먹밥', 18900), ('미나리쌈장항정제육', 17900), ('반건조오징어', 10900), ('버터갈릭감자튀김', 12900),
        ('봄동비빔밥', 12900), ('불맛곱창볶음+주먹밥', 17900), ('뿌링클순살치킨', 13900), ('삼합두부김치', 14900),
        ('슈프림토리카와', 13900), ('얼그레이하이볼', 5500), ('연유멜론', 12900), ('연태하이볼', 5500),
        ('옛날부대찌개', 14900), ('오뎅탕', 14900), ('오리고기파채무침', 15900), ('왕새우부추전', 14900),
        ('요구르트샤베트', 7900), ('우삼겹김치찌개', 14900), ('우삼겹숙주볶음', 12900), ('자몽하이볼', 5500),
        ('짜계치', 5900), ('철판콘치즈', 4900), ('초코범벅아이스크림', 6900), ('테바니카', 12900),
        ('파인애플샤베트', 6900), ('한마리먹태', 10900), ('허니간장순살치킨', 13900), ('허니버터치즈볼', 6900);

    CREATE TEMP TABLE gompocha_exact_price_repair ON COMMIT DROP AS
        SELECT m.id, m.name AS old_name, m.price_krw AS old_price, m.photo_media_id,
               e.name AS new_name, e.price AS new_price
        FROM public.menus m JOIN gompocha_expected_price_repair e
          ON (m.name = e.name AND m.price_krw = e.price)
          OR (m.name = e.name || ', ' || (e.price / 1000)::text AND m.price_krw = e.price % 1000)
        WHERE m.restaurant_id = v_restaurant_id;
    IF (SELECT count(*) FROM gompocha_exact_price_repair) <> 40
       OR (SELECT count(DISTINCT id) FROM gompocha_exact_price_repair) <> 40
       OR (SELECT count(DISTINCT new_name) FROM gompocha_exact_price_repair) <> 40 THEN
        RAISE EXCEPTION 'Gompocha ZIP correction is not a 40/40 bijection; existing data preserved';
    END IF;
    SELECT jsonb_build_object(
        'photos', (SELECT jsonb_agg(jsonb_build_array(id, photo_media_id) ORDER BY id)
                   FROM public.menus WHERE restaurant_id = v_restaurant_id),
        'assets', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.media_assets a
                   WHERE a.menu_id IN (SELECT id FROM public.menus WHERE restaurant_id = v_restaurant_id))
    ) INTO v_before;

    UPDATE public.menus m SET name = p.new_name, price_krw = p.new_price
    FROM gompocha_exact_price_repair p
    WHERE m.id = p.id AND m.name = p.old_name AND m.price_krw = p.old_price
      AND m.photo_media_id IS NOT DISTINCT FROM p.photo_media_id
      AND (m.name IS DISTINCT FROM p.new_name OR m.price_krw IS DISTINCT FROM p.new_price);

    IF (SELECT count(*) FROM public.menus m JOIN gompocha_exact_price_repair p ON p.id = m.id
         WHERE m.name = p.new_name AND m.price_krw = p.new_price) <> 40 THEN
        RAISE EXCEPTION 'Gompocha correction postcondition failed';
    END IF;
    SELECT jsonb_build_object(
        'photos', (SELECT jsonb_agg(jsonb_build_array(id, photo_media_id) ORDER BY id)
                   FROM public.menus WHERE restaurant_id = v_restaurant_id),
        'assets', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.media_assets a
                   WHERE a.menu_id IN (SELECT id FROM public.menus WHERE restaurant_id = v_restaurant_id))
    ) INTO v_after;
    IF v_before IS DISTINCT FROM v_after THEN
        RAISE EXCEPTION 'Gompocha menu IDs, photo associations or media assets changed; transaction aborted';
    END IF;
END;
$repair$;
