import { readQuery } from '@/lib/sql';

/**
 * Application users live in tlm.Users on SOFT1_ERP (ID, Username, DomainName, RoleID).
 * Being in that table is what grants access: a Windows account with no row gets "Access
 * denied". Rows are maintained by hand (or by a future admin screen through a tlm
 * procedure); this module only reads.
 *
 * RoleID is nullable and today the role is only ever displayed, never enforced. Should it
 * one day gate anything, `null` means no rights, not all rights.
 * Table definitions: scripts/sql/2026-09-17-tlm-UserRoles.sql.
 */
export type AppUser = {
  id: number;
  username: string;
  domainName: string | null;
  roleId: number | null;
  roleName: string | null;
};

type UserRow = {
  ID: number;
  Username: string;
  DomainName: string | null;
  RoleID: number | null;
  RoleName: string | null;
};

// LEFT JOIN, never INNER: a user whose RoleID is null, or points at a role since deleted,
// must still sign in. An inner join would turn a lookup gap into "Access denied".
const USER_SELECT = `SELECT TOP 1 u.ID, u.Username, u.DomainName, u.RoleID, r.Name AS RoleName
FROM tlm.Users AS u
LEFT JOIN tlm.UserRoles AS r ON r.ID = u.RoleID`;

const toAppUser = (row: UserRow): AppUser => ({
  id: row.ID,
  username: row.Username,
  domainName: row.DomainName,
  roleId: row.RoleID,
  roleName: row.RoleName,
});

/**
 * Matches the IIS identity (TELMACO\jdoe) against tlm.Users.DomainName, case-insensitive.
 * The explicit COLLATE keeps the comparison stable whatever the column's collation is.
 */
export async function findUserByWindowsIdentity(windowsUserName: string): Promise<AppUser | null> {
  const rows = await readQuery<UserRow>(
    `${USER_SELECT}
WHERE u.DomainName COLLATE Latin1_General_CI_AS = @win COLLATE Latin1_General_CI_AS
ORDER BY u.ID`,
    [{ key: 'win', value: windowsUserName }],
  );
  return rows[0] ? toAppUser(rows[0]) : null;
}

export async function findUserById(id: number): Promise<AppUser | null> {
  const rows = await readQuery<UserRow>(
    `${USER_SELECT}
WHERE u.ID = @id`,
    [{ key: 'id', value: id }],
  );
  return rows[0] ? toAppUser(rows[0]) : null;
}
