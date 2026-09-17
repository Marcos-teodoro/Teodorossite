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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id bigserial primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id bigint,
  title text not null,
  unit_price numeric(10,2) not null,
  quantity int not null default 1
);

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
alter table public.addresses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

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
create policy "admin_orders_all" on public.orders for all using (public.is_admin()) with check (public.is_admin());

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
