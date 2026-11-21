-- Supabase SQL for Mou5ayam chtee
-- Execute entirely in the Supabase SQL Editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  nom text not null default '',
  role text not null default 'animateur' check (role in ('admin','animateur')),
  archive boolean not null default false
);

create table if not exists public.camps (
  id uuid primary key default gen_random_uuid(), nom text not null, lieu text not null default '',
  date_debut date, date_fin date, statut text not null default 'preparation' check (statut in ('preparation','en_cours','termine')),
  responsable uuid references public.profiles(id), notes text, archive boolean not null default false, cree_le timestamptz not null default now()
);
create table if not exists public.participants (id uuid primary key default gen_random_uuid(), camp_id uuid not null references public.camps(id), nom text not null, age integer, contact text, present boolean not null default false, notes text, archive boolean not null default false);
create table if not exists public.materiel (id uuid primary key default gen_random_uuid(), camp_id uuid not null references public.camps(id), nom text not null, quantite integer not null default 0, etat text not null default 'bon' check (etat in ('bon','abime','manquant')), notes text, archive boolean not null default false);
create table if not exists public.depenses (id uuid primary key default gen_random_uuid(), camp_id uuid not null references public.camps(id), description text not null, montant numeric(10,3) not null default 0, date_depense date not null default current_date, archive boolean not null default false);
create table if not exists public.animateurs (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id), camp_id uuid not null references public.camps(id), nom text not null, archive boolean not null default false);
create table if not exists public.activites (id uuid primary key default gen_random_uuid(), camp_id uuid not null references public.camps(id), nom text not null, description text, date_activite timestamptz, archive boolean not null default false);
create table if not exists public.taches_fani (id uuid primary key default gen_random_uuid(), activite_id uuid references public.activites(id), assigne_a uuid not null references public.animateurs(id), description text not null, statut text not null default 'a_faire' check (statut in ('a_faire','fait')), date_fait timestamptz, archive boolean not null default false);
create table if not exists public.publications (id uuid primary key default gen_random_uuid(), camp_id uuid not null references public.camps(id), auteur_id uuid not null references auth.users(id), auteur_nom text not null, texte text, fichier_path text, fichier_nom text, archive boolean not null default false, cree_le timestamptz not null default now(), constraint publication_contenu check (texte is not null or fichier_path is not null));
create table if not exists public.historique (id uuid primary key default gen_random_uuid(), quand timestamptz not null default now(), utilisateur uuid, table_nom text not null, ligne_id uuid, action text not null, avant jsonb, apres jsonb);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id, nom, role) values (new.id, coalesce(new.raw_user_meta_data->>'nom', split_part(new.email,'@',1)), 'animateur') on conflict(id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path=public as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.archive=false)
$$;

create or replace function public.no_delete() returns trigger language plpgsql as $$
begin raise exception 'Les suppressions sont interdites. Utilisez archive=true.'; end $$;

create or replace function public.audit_row() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.historique(utilisateur,table_nom,ligne_id,action,avant,apres)
  values(auth.uid(),tg_table_name,coalesce((case when tg_op='DELETE' then null else to_jsonb(new)->>'id' end)::uuid,null),tg_op,
    case when tg_op='INSERT' then null else to_jsonb(old) end,
    case when tg_op='DELETE' then null else to_jsonb(new) end);
  return coalesce(new,old);
end $$;

create or replace function public.restrict_task_update() returns trigger language plpgsql security definer set search_path=public as $$
declare key text; value_old jsonb; value_new jsonb;
begin
  if not public.is_admin() then
    if not exists(select 1 from public.animateurs a where a.id=old.assigne_a and a.user_id=auth.uid() and a.archive=false) then
      raise exception 'Vous ne pouvez modifier que vos propres tâches.';
    end;
    if (to_jsonb(new)-array['statut','date_fait','id']) <> (to_jsonb(old)-array['statut','date_fait','id']) then
      raise exception 'Seuls le statut et date_fait peuvent être modifiés.';
    end;
  end if;
  if new.statut='fait' and old.statut is distinct from 'fait' then new.date_fait:=now();
  elsif new.statut='a_faire' then new.date_fait:=null; end if;
  return new;
end $$;

DO $$ DECLARE r record; BEGIN
  FOR r IN select tablename from pg_tables where schemaname='public' LOOP
    begin execute format('create trigger trg_no_delete_%I before delete on public.%I for each row execute function public.no_delete()', r.tablename, r.tablename); exception when duplicate_object then null; end;
    if r.tablename <> 'historique' then
      begin execute format('create trigger trg_audit_%I after insert or update on public.%I for each row execute function public.audit_row()', r.tablename, r.tablename); exception when duplicate_object then null; end;
    end if;
  END LOOP;
END $$;
drop trigger if exists trg_restrict_task_update on public.taches_fani;
create trigger trg_restrict_task_update before update on public.taches_fani for each row execute function public.restrict_task_update();

alter table public.profiles enable row level security;
alter table public.camps enable row level security;
alter table public.participants enable row level security;
alter table public.materiel enable row level security;
alter table public.depenses enable row level security;
alter table public.animateurs enable row level security;
alter table public.activites enable row level security;
alter table public.taches_fani enable row level security;
alter table public.publications enable row level security;
alter table public.historique enable row level security;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY array['profiles','camps','participants','materiel','depenses','animateurs','activites','taches_fani','publications'] LOOP
    execute format('drop policy if exists "select_authenticated" on public.%I',t);
    execute format('create policy "select_authenticated" on public.%I for select to authenticated using (true)',t);
    execute format('drop policy if exists "insert_admin" on public.%I',t);
    execute format('create policy "insert_admin" on public.%I for insert to authenticated with check (public.is_admin())',t);
    execute format('drop policy if exists "update_admin" on public.%I',t);
  END LOOP;
END $$;

-- Profile creation exception and publication exception
create policy "profiles_own_insert" on public.profiles for insert to authenticated with check (id=auth.uid() and role='animateur');
create policy "profiles_own_update" on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid() and role='animateur');
create policy "admin_update_profiles" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin_update_camps" on public.camps for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin_update_participants" on public.participants for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin_update_materiel" on public.materiel for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin_update_depenses" on public.depenses for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin_update_animateurs" on public.animateurs for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin_update_activites" on public.activites for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin_update_tasks" on public.taches_fani for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "owner_update_task" on public.taches_fani for update to authenticated using(exists(select 1 from public.animateurs a where a.id=taches_fani.assigne_a and a.user_id=auth.uid())) with check(exists(select 1 from public.animateurs a where a.id=taches_fani.assigne_a and a.user_id=auth.uid()));
create policy "publish_own" on public.publications for insert to authenticated with check(auteur_id=auth.uid());
create policy "archive_publication_admin" on public.publications for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "historique_admin_select" on public.historique for select to authenticated using(public.is_admin());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('publications','publications',false,10485760,array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;

create policy "publications_storage_select" on storage.objects for select to authenticated using(bucket_id='publications');
create policy "publications_storage_insert" on storage.objects for insert to authenticated with check(bucket_id='publications');

alter publication supabase_realtime add table public.publications;
