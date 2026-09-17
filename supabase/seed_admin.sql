-- Promove o usuário Supabase a admin da Teodora
-- Rode no SQL Editor do Supabase após o usuário existir em auth.users

insert into public.profiles (id, email, name, role)
values (
  'fa162d9e-8c93-4a6a-994d-c41c7a0e31d5',
  'admin@gmail.com',
  'Admin Teodora',
  'admin'
)
on conflict (id) do update
set email = excluded.email,
    role = 'admin',
    name = coalesce(nullif(public.profiles.name, ''), excluded.name),
    updated_at = now();

update public.profiles
set role = 'admin',
    email = 'admin@gmail.com'
where id = 'fa162d9e-8c93-4a6a-994d-c41c7a0e31d5';
