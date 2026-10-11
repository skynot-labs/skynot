export * from "./domain";
export { RosterProjection, type RoleProfile, type RoleSummary } from "./application/roster-projection";
export { TeamService, type Proposal } from "./application/team-service";
export { YamlTeamRepository, loadTeam, parseTeamFile } from "./adapters/yaml-team";
