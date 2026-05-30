import type { Format } from './constraint.js';

export type Email = Format<'email'>;
export type UUID = Format<'uuid'>;
export type URL = Format<'url'>;
export type IPv4 = Format<'ipv4'>;
export type IPv6 = Format<'ipv6'>;
export type Date = Format<'date'>;
export type DateTime = Format<'date-time'>;
export type Byte = Format<'byte'>;
export type Password = Format<'password'>;
export type Regex = Format<'regex'>;
export type Hostname = Format<'hostname'>;
export type Time = Format<'time'>;
export type Duration = Format<'duration'>;
export type ObjectId = Format<'objectId'>;
