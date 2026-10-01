import { describe, expect, it } from "vitest";
import { LINKS, Link } from "./link.js";
import { mulberry32 } from "./rng.js";

describe("Link", () => {
  it("delivers in order at exactly oneWayMs with no jitter or loss", () => {
    const link = new Link<number>({ name: "t", oneWayMs: 40, jitterMs: 0, lossPct: 0 }, mulberry32(1));
    link.send(0, 1);
    link.send(5, 2);
    expect(link.receive(39)).toEqual([]);
    expect(link.receive(40)).toEqual([1]);
    expect(link.receive(44)).toEqual([]);
    expect(link.receive(45)).toEqual([2]);
  });

  it("never reorders, even with jitter", () => {
    const link = new Link<number>({ name: "t", oneWayMs: 40, jitterMs: 20, lossPct: 0 }, mulberry32(7));
    for (let i = 0; i < 200; i++) link.send(i, i);
    const got: number[] = [];
    for (let t = 0; t < 1000; t++) got.push(...link.receive(t));
    expect(got).toEqual([...Array(200).keys()]);
  });

  it("a lost message delays everything behind it by one round trip (head-of-line)", () => {
    const always = () => 0; // rng 0 < lossPct/100 → every message is 'lost' once
    const link = new Link<number>({ name: "t", oneWayMs: 40, jitterMs: 0, lossPct: 100 }, always);
    link.send(0, 1);
    link.send(1, 2);
    expect(link.receive(80)).toEqual([]);
    expect(link.receive(120)).toEqual([1]);
    expect(link.receive(121)).toEqual([2]);
  });

  it("the named profiles are the spec's", () => {
    expect(LINKS.lan).toMatchObject({ oneWayMs: 0.5, jitterMs: 0, lossPct: 0 });
    expect(LINKS.net80clean).toMatchObject({ oneWayMs: 40, jitterMs: 2, lossPct: 0 });
    expect(LINKS.net80).toMatchObject({ oneWayMs: 40, jitterMs: 10, lossPct: 1 });
    expect(LINKS.net150).toMatchObject({ oneWayMs: 75, jitterMs: 15, lossPct: 1 });
  });
});
