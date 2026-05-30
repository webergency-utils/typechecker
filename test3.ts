export type Format<T> = { format: T };
export type format = {
    Email: Format<'email'>;
}

type MyEmail = format['Email']; // works
type MyEmail2 = format.Email; // does this work?
