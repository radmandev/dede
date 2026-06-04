-- Allow any authenticated user to see bitrix24 accounts/channels that have
-- no owner yet (created by the installer webhook with no user context).
-- Once a user claims an account, only they can update/delete it.

-- bitrix24_accounts: split for-all policy into separate per-operation policies
drop policy if exists bitrix24_accounts_owner_access on bitrix24_accounts;

create policy bitrix24_accounts_select on bitrix24_accounts
  for select using (
    auth.uid() is not null
    and (
      owner_id is null
      or exists (
        select 1 from profiles p
        where p.id = bitrix24_accounts.owner_id
          and p.auth_uid = auth.uid()::uuid
      )
    )
  );

create policy bitrix24_accounts_insert on bitrix24_accounts
  for insert with check (
    exists (
      select 1 from profiles p
      where p.id = owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  );

create policy bitrix24_accounts_update on bitrix24_accounts
  for update using (
    owner_id is null
    or exists (
      select 1 from profiles p
      where p.id = bitrix24_accounts.owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  ) with check (
    exists (
      select 1 from profiles p
      where p.id = bitrix24_accounts.owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  );

create policy bitrix24_accounts_delete on bitrix24_accounts
  for delete using (
    exists (
      select 1 from profiles p
      where p.id = bitrix24_accounts.owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  );

-- bitrix24_open_channels: same pattern
drop policy if exists bitrix24_open_channels_owner_access on bitrix24_open_channels;

create policy bitrix24_open_channels_select on bitrix24_open_channels
  for select using (
    auth.uid() is not null
    and (
      owner_id is null
      or exists (
        select 1 from profiles p
        where p.id = bitrix24_open_channels.owner_id
          and p.auth_uid = auth.uid()::uuid
      )
    )
  );

create policy bitrix24_open_channels_insert on bitrix24_open_channels
  for insert with check (
    exists (
      select 1 from profiles p
      where p.id = owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  );

create policy bitrix24_open_channels_update on bitrix24_open_channels
  for update using (
    owner_id is null
    or exists (
      select 1 from profiles p
      where p.id = bitrix24_open_channels.owner_id
        and p.auth_uid = auth.uid()::uuid
      )
  ) with check (
    exists (
      select 1 from profiles p
      where p.id = bitrix24_open_channels.owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  );

create policy bitrix24_open_channels_delete on bitrix24_open_channels
  for delete using (
    exists (
      select 1 from profiles p
      where p.id = bitrix24_open_channels.owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  );
