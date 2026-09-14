import { readQuery } from '@/lib/sql';

/**
 * Application users live in tlm.Users on SOFT1_ERP (ID, Username, DomainName). Being in
 * that table is what grants access: a Windows account with no row gets "Access denied".
 * Rows are maintained by hand (or by a future admin screen through a tlm procedure);
 * this module only reads. Table definition: scripts/sql/2026-09-14-tlm-Users.sql.
 */
export type AppUser = {
  id: number;
  username: string;
  domainName: string | null;
};

type UserRow = { ID: number; Username: string; DomainName: string | null };

const USER_COLUMNS = 'ID, Username, DomainName';

const toAppUser = (row: UserRow): AppUser => ({
  id: row.ID,
  username: row.Username,
  domainName: row.DomainName,
});

/**
 * Matches the IIS identity (TELMACO\jdoe) against tlm.Users.DomainName, case-insensitive.
 * The explicit COLLATE keeps the comparison stable whatever the column's collation is.
 */
export async function findUserByWindowsIdentity(windowsUserName: string): Promise<AppUser | null> {
  const rows = await readQuery<UserRow>(
    `SELECT TOP 1 ${USER_COLUMNS}
FROM tlm.Users
WHERE DomainName COLLATE Latin1_General_CI_AS = @win COLLATE Latin1_General_CI_AS
ORDER BY ID`,
    [{ key: 'win', value: windowsUserName }],
  );
  return rows[0] ? toAppUser(rows[0]) : null;
}

export async function findUserById(id: number): Promise<AppUser | null> {
  const rows = await readQuery<UserRow>(
    `SELECT TOP 1 ${USER_COLUMNS} FROM tlm.Users WHERE ID = @id`,
    [{ key: 'id', value: id }],
  );
  return rows[0] ? toAppUser(rows[0]) : null;
}
