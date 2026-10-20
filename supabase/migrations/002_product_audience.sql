-- Público do produto (subcategoria): feminino, masculino, unissex ou vazio.
alter table public.products add column if not exists audience text default '';
