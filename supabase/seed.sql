-- =============================================================================
-- LOCAL DEVELOPMENT SEED ONLY. Applied by `supabase db reset` on the local
-- Docker stack. Never run against production: production users are invited
-- through the Supabase dashboard (see docs/SETUP.md).
--
-- Local logins (password for all: life-local-dev):
--   tim@life.local, sophie@life.local       -> household "Tim & Sophie"
--   outsider@life.local                     -> a different household (RLS tests)
-- =============================================================================

do $$
declare
  v_user record;
begin
  for v_user in
    select * from (values
      ('11111111-1111-1111-1111-111111111111'::uuid, 'tim@life.local', 'Tim'),
      ('22222222-2222-2222-2222-222222222222'::uuid, 'sophie@life.local', 'Sophie'),
      ('33333333-3333-3333-3333-333333333333'::uuid, 'outsider@life.local', 'Outsider')
    ) as u (id, email, name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user.id, 'authenticated', 'authenticated', v_user.email,
      extensions.crypt('life-local-dev', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', v_user.name), now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_user.id, v_user.id::text,
            jsonb_build_object('sub', v_user.id::text, 'email', v_user.email, 'email_verified', true),
            'email', now(), now(), now());
  end loop;
end;
$$;

select public.bootstrap_household('Tim & Sophie', '[
  {"email": "tim@life.local", "display_name": "Tim", "avatar_color": "indigo"},
  {"email": "sophie@life.local", "display_name": "Sophie", "avatar_color": "rose"}
]'::jsonb);

select public.bootstrap_household('Somebody else', '[
  {"email": "outsider@life.local", "display_name": "Outsider", "avatar_color": "amber"}
]'::jsonb);

-- The period tracker shows on Sophie's Health tab (profiles created above, after migrations ran).
update public.profiles set tracks_periods = true where id = '22222222-2222-2222-2222-222222222222';
