export const PROJECT_ID = /^[a-z][a-z0-9-]{1,39}$/;
export const MAX_PROJECT_NAME = 60;
export const MAX_PROJECT_DESCRIPTION = 280;
export const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;

export const ORDER_ID = /^WO-\d{4}$/;
export const RUN_ID = /^run_[0-9a-f-]+$/;
export const TEAM_CHANGE_ID = /^chg_[0-9a-f-]+$/;
export const BRIEFING_CHANGE_ID = /^brf_[0-9a-f-]+$/;
export const ROLE_NAME = /^[a-z][a-z0-9-]{1,23}$/;

// A time of day on the office's own clock.
export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

export const MAX_TEXT = 4000;
export const MIN_FOCUS = 3;
export const MAX_FOCUS = 300;
export const MINUTES_BUCKETS = ["lt5", "5-15", "15-30", "gt30"] as const;

export const PREFERENCE_KEY = /^(avatar|studio)\/[a-z][a-z0-9-]{1,39}(\/[a-z][a-z0-9_-]{0,39})?$/;
export const MAX_PREFERENCE_BYTES = 2048;
