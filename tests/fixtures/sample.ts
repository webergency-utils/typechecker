import { validate } from '../../src/index';

interface Point {
  x: number;
  y: number;
}

interface Line {
  start: Point;
  end: Point;
}

interface User {
  id: string;
  name: string;
  age?: number;
  tags: string[];
  createdAt: Date;

  foo: Point | Line;
}

const inputData = { id: "123", name: "Alice", tags: ["admin"], createdAt: "2026-05-12T00:00:00Z", extra: "should-strip" };
const validationResult = validate<User>(inputData, 'strip');
console.log(validationResult);
