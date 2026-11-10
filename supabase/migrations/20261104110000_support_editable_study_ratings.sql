create table public.study_caption_ratings (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  study_caption_mapping_id bigint not null
    references public.study_caption_mappings(id) on delete cascade,
  caption_id uuid not null references public.captions(id) on delete cascade,
  vote_value public.study_vote_value not null,
  created_datetime_utc timestamptz not null default statement_timestamp(),
  modified_datetime_utc timestamptz not null default statement_timestamp(),
  primary key (profile_id, study_caption_mapping_id)
);

alter table public.study_caption_ratings enable row level security;
revoke all on public.study_caption_ratings from public, anon, authenticated;
grant select, insert, update on public.study_caption_ratings to authenticated;

create policy "Participants can read their study caption ratings"
  on public.study_caption_ratings for select to authenticated
  using (profile_id = (select auth.uid()));

create policy "Participants can write their study caption ratings"
  on public.study_caption_ratings for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and exists (
      select 1
      from public.study_caption_mappings mapping
      where mapping.id = study_caption_ratings.study_caption_mapping_id
        and mapping.caption_id = study_caption_ratings.caption_id
    )
  );

create policy "Participants can update their study caption ratings"
  on public.study_caption_ratings for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (
    profile_id = (select auth.uid())
    and exists (
      select 1
      from public.study_caption_mappings mapping
      where mapping.id = study_caption_ratings.study_caption_mapping_id
        and mapping.caption_id = study_caption_ratings.caption_id
    )
  );

create function public.stamp_study_caption_rating_modified()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.modified_datetime_utc := statement_timestamp();
  return new;
end;
$$;
revoke all on function public.stamp_study_caption_rating_modified()
  from public, anon, authenticated;

create trigger stamp_study_caption_rating_modified
  before update on public.study_caption_ratings
  for each row execute function public.stamp_study_caption_rating_modified();

create or replace function public.stamp_study_participation_end()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.ended_at := coalesce(old.ended_at, statement_timestamp());
  return new;
end;
$$;

create or replace function public.end_study(p_study_id bigint, p_completion_stats jsonb)
returns public.study_participations
language plpgsql security invoker set search_path = '' as $$
declare participation public.study_participations;
begin
  if not public.valid_study_completion_stats(p_completion_stats) then
    raise exception 'Invalid study stats' using errcode = '22023';
  end if;
  update public.study_participations
  set ended_at = statement_timestamp(), completion_stats = p_completion_stats
  where profile_id = auth.uid() and study_id = p_study_id
  returning * into participation;
  if not found then
    raise exception 'Start this study before ending it';
  end if;
  return participation;
end;
$$;
