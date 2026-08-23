-- Fruitly backend · 0003 — catalogue seed + the midnight loop schedule

insert into public.fruits (id, name, cut_desc, grams_per_cup, price_paise, color, sold_out, sort) values
  ('mango',       'Alphonso mango', 'Peeled and cubed',   220, 12000, '#FFC233', false, 10),
  ('kiwi',        'Kiwi',           'Peeled and sliced',  180,  9000, '#A8C64D', false, 20),
  ('watermelon',  'Watermelon',     'Deseeded and cubed', 250,  8000, '#FF6B5A', false, 30),
  ('pomegranate', 'Pomegranate',    'Hand-seeded',        200, 11000, '#8E3B6B', false, 40),
  ('papaya',      'Papaya',         'Deseeded and cubed', 250,  7000, '#F2A93B', false, 50),
  ('pineapple',   'Pineapple',      'Cored and ringed',   220,  9500, '#E8B94A', false, 60),
  ('grapes',      'Black grapes',   'Washed, seedless',   200,  8500, '#5A2646', false, 70),
  ('strawberry',  'Strawberry',     'Hulled and halved',  160, 14000, '#B94A48', true,  80);

insert into public.boxes (id, name, description, grams, cups, fruit_kinds, price_paise, is_premium, sort) values
  ('solo',    'Solo Box',    'One person, one perfect cup.',                 250, 1, '3 kinds',          12900, false, 10),
  ('couple',  'Couple Box',  'Two cups, cut two ways.',                      450, 2, '4 kinds',          22900, false, 20),
  ('family',  'Family Box',  'One bowl the whole table shares.',             900, 4, '5 kinds',          39900, false, 30),
  ('premium', 'Premium Box', 'The rare shelf — berries, avocado, dragon fruit.', 700, 3, 'Seasonal exotics', 59900, true, 40);

-- The midnight loop: orders lock at 00:00 IST; tickets are generated at 00:05 IST
-- (18:35 UTC) for that same IST date.
create extension if not exists pg_cron;
select cron.schedule(
  'fruitly-generate-orders',
  '35 18 * * *',
  $$select public.generate_orders(public.ist_today())$$
);
