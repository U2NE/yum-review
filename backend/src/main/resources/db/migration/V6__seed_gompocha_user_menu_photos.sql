-- User-provided Gompocha Jukjeon menu names, prices, and photos from the supplied ZIP.
-- Menu prices and names are parsed from the photo filenames.
ALTER TABLE menu ADD COLUMN photo_url VARCHAR(500);

INSERT INTO restaurant (name, description, region)
VALUES ('곰포차 죽전점', '사용자가 제공한 메뉴 사진과 파일명 기준 메뉴 정보', '죽전')
ON CONFLICT (name) DO UPDATE
SET region = COALESCE(restaurant.region, EXCLUDED.region);

INSERT INTO menu (restaurant_id, name, price_krw, cuisine_category, photo_url)
SELECT restaurant.id, seed.name, seed.price_krw, 'PUB', seed.photo_url
FROM (VALUES    ('간장계란밥', 3900, '/menu-images/gompocha/001.png'),
    ('곰라면', 3900, '/menu-images/gompocha/002.png'),
    ('곰발파닭', 14900, '/menu-images/gompocha/003.jpeg'),
    ('곰포''s타코', 11900, '/menu-images/gompocha/004.jpeg'),
    ('김치항정파스탕', 17900, '/menu-images/gompocha/005.jpeg'),
    ('닭껍질튀김', 12900, '/menu-images/gompocha/006.jpeg'),
    ('닭연골튀김', 11900, '/menu-images/gompocha/007.jpeg'),
    ('대창모츠나베', 20900, '/menu-images/gompocha/008.jpeg'),
    ('돼지고기김치구이', 15900, '/menu-images/gompocha/009.jpeg'),
    ('뚝배기치즈떡볶이', 11900, '/menu-images/gompocha/010.jpeg'),
    ('모듬감자튀김', 10900, '/menu-images/gompocha/011.png'),
    ('모짜렐라김치볶음밥', 14900, '/menu-images/gompocha/012.jpeg'),
    ('무뼈국물닭발+주먹밥', 18900, '/menu-images/gompocha/013.jpeg'),
    ('미나리쌈장항정제육', 17900, '/menu-images/gompocha/014.jpeg'),
    ('반건조오징어', 10900, '/menu-images/gompocha/015.jpeg'),
    ('버터갈릭감자튀김', 12900, '/menu-images/gompocha/016.jpeg'),
    ('봄동비빔밥', 12900, '/menu-images/gompocha/017.jpeg'),
    ('불맛곱창볶음+주먹밥', 17900, '/menu-images/gompocha/018.jpeg'),
    ('뿌링클순살치킨', 13900, '/menu-images/gompocha/019.jpeg'),
    ('삼합두부김치', 14900, '/menu-images/gompocha/020.jpeg'),
    ('슈프림토리카와', 13900, '/menu-images/gompocha/021.jpeg'),
    ('얼그레이하이볼', 5500, '/menu-images/gompocha/022.jpeg'),
    ('연유멜론', 12900, '/menu-images/gompocha/023.jpeg'),
    ('연태하이볼', 5500, '/menu-images/gompocha/024.jpeg'),
    ('옛날부대찌개', 14900, '/menu-images/gompocha/025.jpeg'),
    ('오뎅탕', 14900, '/menu-images/gompocha/026.jpeg'),
    ('오리고기파채무침', 15900, '/menu-images/gompocha/027.jpeg'),
    ('왕새우부추전', 14900, '/menu-images/gompocha/028.jpeg'),
    ('요구르트샤베트', 7900, '/menu-images/gompocha/029.jpeg'),
    ('우삼겹김치찌개', 14900, '/menu-images/gompocha/030.jpeg'),
    ('우삼겹숙주볶음', 12900, '/menu-images/gompocha/031.jpeg'),
    ('자몽하이볼', 5500, '/menu-images/gompocha/032.jpeg'),
    ('짜계치', 5900, '/menu-images/gompocha/033.png'),
    ('철판콘치즈', 4900, '/menu-images/gompocha/034.jpeg'),
    ('초코범벅아이스크림', 6900, '/menu-images/gompocha/035.jpeg'),
    ('테바니카', 12900, '/menu-images/gompocha/036.jpeg'),
    ('파인애플샤베트', 6900, '/menu-images/gompocha/037.png'),
    ('한마리먹태', 10900, '/menu-images/gompocha/038.jpeg'),
    ('허니간장순살치킨', 13900, '/menu-images/gompocha/039.jpeg'),
    ('허니버터치즈볼', 6900, '/menu-images/gompocha/040.jpeg')
) AS seed(name, price_krw, photo_url)
JOIN restaurant ON restaurant.name = '곰포차 죽전점'
ON CONFLICT (restaurant_id, name) DO UPDATE
SET price_krw = EXCLUDED.price_krw,
    cuisine_category = EXCLUDED.cuisine_category,
    photo_url = EXCLUDED.photo_url,
    active = TRUE;