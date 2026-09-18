-- Teodora — schema inicial (Supabase Postgres)
-- Rode no SQL Editor do Supabase ou via CLI: supabase db push

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text not null default '',
  phone text default '',
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id bigserial primary key,
  slug text not null unique,
  name text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id bigserial primary key,
  title text not null,
  brand_tag text default '',
  volume text default '',
  category_id bigint references public.categories(id) on delete set null,
  category_slug text not null default 'perfumes',
  family text default 'floral',
  intensity text default 'edp',
  occasion text default 'dia',
  sensation text default 'romantico',
  price numeric(10,2) not null,
  old_price numeric(10,2),
  badge text default '',
  notes text default '',
  description text default '',
  ritual text default '',
  ingredients text default '',
  pyramid_top text default '',
  pyramid_heart text default '',
  pyramid_base text default '',
  similar_ids jsonb not null default '[]'::jsonb,
  stock int not null default 50,
  active boolean not null default true,
  weight_kg numeric(8,3) not null default 0.500,
  height_cm numeric(8,2) not null default 12,
  width_cm numeric(8,2) not null default 8,
  length_cm numeric(8,2) not null default 8,
  cover_image text,
  rating numeric(3,2) default 4.8,
  reviews int default 48,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_images (
  id bigserial primary key,
  product_id bigint not null references public.products(id) on delete cascade,
  url text not null,
  sort_order int not null default 0,
  is_cover boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.product_variants (
  id bigserial primary key,
  product_id bigint not null references public.products(id) on delete cascade,
  label text not null,
  sku text not null default '',
  price numeric(10,2) not null,
  old_price numeric(10,2),
  stock int not null default 0,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.addresses (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text default 'Casa',
  cep text not null,
  logradouro text not null default '',
  numero text not null default '',
  complemento text default '',
  bairro text default '',
  cidade text default '',
  uf text default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending',
  merchandise numeric(10,2) not null default 0,
  shipping_cost numeric(10,2) not null default 0,
  coupon_code text default '',
  coupon_discount numeric(10,2) not null default 0,
  pix_discount numeric(10,2) not null default 0,
  total numeric(10,2) not null,
  payment_hint text default 'pix',
  mp_payment_id text,
  mp_status text,
  payer_name text,
  payer_email text,
  payer_doc text,
  payer_phone text,
  payer_address text,
  shipping_snapshot jsonb not null default '{}'::jsonb,
  stock_deducted boolean not null default false,
  tracking_code text default '',
  tracking_url text default '',
  admin_notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id bigserial primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id bigint,
  variant_id bigint references public.product_variants(id) on delete set null,
  sku text default '',
  variant_label text default '',
  title text not null,
  unit_price numeric(10,2) not null,
  quantity int not null default 1
);

create table if not exists public.coupons (
  id bigserial primary key,
  code text not null unique,
  discount_type text not null default 'percent' check (discount_type in ('percent', 'fixed')),
  discount_value numeric(10,2) not null check (discount_value > 0),
  min_order numeric(10,2) not null default 0,
  usage_limit int,
  uses_count int not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.order_status_history (
  id bigserial primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  old_status text,
  new_status text not null,
  source text not null default 'admin',
  actor_id uuid references public.profiles(id) on delete set null,
  note text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id bigserial primary key,
  product_id bigint not null references public.products(id) on delete cascade,
  variant_id bigint references public.product_variants(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  movement_type text not null,
  quantity int not null,
  balance_after int not null,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_audit_log (
  id bigserial primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.orders
  add column if not exists stock_deducted boolean not null default false;

alter table public.orders add column if not exists tracking_code text default '';
alter table public.orders add column if not exists tracking_url text default '';
alter table public.orders add column if not exists admin_notes text default '';
alter table public.order_items add column if not exists variant_id bigint references public.product_variants(id) on delete set null;
alter table public.order_items add column if not exists sku text default '';
alter table public.order_items add column if not exists variant_label text default '';

-- Trigger: cria profile ao cadastrar usuário
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'customer')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Storage bucket (rode no dashboard se CLI não criar)
insert into storage.buckets (id, name, public)
values ('product-photos', 'product-photos', true)
on conflict (id) do nothing;

-- RLS
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_variants enable row level security;
alter table public.addresses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.coupons enable row level security;
alter table public.site_settings enable row level security;
alter table public.order_status_history enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.admin_audit_log enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- Catálogo público (ativos)
create policy "categories_public_read" on public.categories for select using (active = true or public.is_admin());
create policy "products_public_read" on public.products for select using (active = true or public.is_admin());
create policy "product_images_public_read" on public.product_images for select using (true);
create policy "product_variants_public_read" on public.product_variants for select using (
  exists (select 1 from public.products p where p.id = product_id and (p.active = true or public.is_admin()))
);
create policy "site_settings_public_read" on public.site_settings for select using (true);

-- Profiles
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id or public.is_admin());
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- Addresses
create policy "addresses_own" on public.addresses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Orders
create policy "orders_select_own" on public.orders for select using (auth.uid() = user_id or public.is_admin());
create policy "order_items_select_own" on public.order_items for select using (
  exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_admin()))
);

-- Admin writes via service_role / BFF (policies for authenticated admin)
create policy "admin_categories_all" on public.categories for all using (public.is_admin()) with check (public.is_admin());
create policy "admin_products_all" on public.products for all using (public.is_admin()) with check (public.is_admin());
create policy "admin_product_images_all" on public.product_images for all using (public.is_admin()) with check (public.is_admin());
create policy "admin_product_variants_all" on public.product_variants for all using (public.is_admin()) with check (public.is_admin());
create policy "admin_orders_all" on public.orders for all using (public.is_admin()) with check (public.is_admin());
create policy "admin_coupons_all" on public.coupons for all using (public.is_admin()) with check (public.is_admin());
create policy "admin_settings_all" on public.site_settings for all using (public.is_admin()) with check (public.is_admin());
create policy "admin_order_history_all" on public.order_status_history for all using (public.is_admin()) with check (public.is_admin());
create policy "admin_inventory_movements_all" on public.inventory_movements for all using (public.is_admin()) with check (public.is_admin());
create policy "admin_audit_log_all" on public.admin_audit_log for all using (public.is_admin()) with check (public.is_admin());

-- Storage policies
create policy "product_photos_public_read" on storage.objects
  for select using (bucket_id = 'product-photos');
create policy "product_photos_admin_write" on storage.objects
  for insert with check (bucket_id = 'product-photos' and public.is_admin());
create policy "product_photos_admin_update" on storage.objects
  for update using (bucket_id = 'product-photos' and public.is_admin());
create policy "product_photos_admin_delete" on storage.objects
  for delete using (bucket_id = 'product-photos' and public.is_admin());

-- Seed categorias
insert into public.categories (slug, name, sort_order) values
  ('perfumes', 'Perfumes', 1),
  ('skincare', 'Skincare', 2),
  ('maquiagem', 'Maquiagem', 3),
  ('cabelos', 'Cabelos', 4),
  ('corpo', 'Corpo & Banho', 5),
  ('kits', 'Kits', 6)
on conflict (slug) do nothing;

insert into public.coupons (code, discount_type, discount_value, min_order, active)
values ('TEODORA10', 'percent', 10, 0, true)
on conflict (code) do nothing;

insert into public.site_settings (key, value) values
  ('hero_eyebrow', 'TEODORA'),
  ('hero_title', E'Perfumes originais.\nEntrega em todo o Brasil.'),
  ('hero_image', 'https://images.unsplash.com/photo-1595425970377-c9703cf48b6d?auto=format&fit=crop&w=1400&q=85'),
  ('hero_button', 'Ver produtos'),
  ('whatsapp_url', 'https://wa.me/'),
  ('instagram_url', '#'),
  ('facebook_url', '#'),
  ('youtube_url', '#'),
  ('pinterest_url', '#'),
  ('installments', '6'),
  ('footer_description', 'Perfumes originais com entrega para todo o Brasil.')
on conflict (key) do nothing;
