import { describe, expect, it } from "vitest";
import { extractBio, extractCaption, parseCompactNumber, parseOgAuthorAndDate, parseOgCounts, parseOgName, pickCaptionFromText } from "@/integrations/browser/cdp";

describe("Instagram page parsing (strings seen live on 2026-10-12)", () => {
  it("reads the caption from a post's og:title", () => {
    const title = 'Dr. Raphael Braga | Cirurgião Dentista São Paulo - Zona Sul no Instagram: "🦷🪥😁 A abfração dentária é um desgaste que acontece no dente.\nExistem vários fatores"';
    expect(extractCaption("129 likes, 3 comments - dr.raphaelbraga no September 26, 2024", title)).toBe("🦷🪥😁 A abfração dentária é um desgaste que acontece no dente.\nExistem vários fatores");
    expect(extractCaption("129 likes, 0 comments - lopespitter no June 15, 2026", "Pitter Lopes no Instagram")).toBeNull();
    expect(extractCaption('12 likes, 1 comments - someone on October 1, 2026: "English caption"', "Some One on Instagram")).toBe("English caption");
  });
  it("reads author and date from og:description, in Portuguese and English", () => {
    expect(parseOgAuthorAndDate("129 likes, 0 comments - lopespitter no June 15, 2026")).toEqual({ username: "lopespitter", postedAt: "2026-06-15T12:00:00.000Z" });
    expect(parseOgAuthorAndDate("5 likes, 0 comments - dra.ana_s on October 1, 2026")).toEqual({ username: "dra.ana_s", postedAt: "2026-10-01T12:00:00.000Z" });
    expect(parseOgAuthorAndDate("nothing here")).toEqual({ username: null, postedAt: null });
  });
  it("picks a caption line from page text, skipping navigation and counters", () => {
    const text = ["Página inicial", "Reels", "lopespitter", "129 curtidas", "Hoje eu mostro como organizar o WhatsApp da empresa por setores sem perder mensagem", "Áudio original"].join("\n");
    expect(pickCaptionFromText(text, "lopespitter")).toBe("Hoje eu mostro como organizar o WhatsApp da empresa por setores sem perder mensagem");
    expect(pickCaptionFromText("Página inicial\nReels", "x")).toBeNull();
  });
  it("parses profile counts, names and bios from og tags", () => {
    expect(parseOgCounts("4.2K Followers, 500 Following, 180 Posts - See Instagram photos and videos")).toEqual({ followers: 4200, following: 500, posts: 180 });
    expect(parseOgCounts("9.913 seguidores, 1.200 seguindo, 150 publicações")).toEqual({ followers: 9913, following: 1200, posts: 150 });
    expect(parseCompactNumber("1,2M")).toBe(1_200_000);
    expect(parseOgName("Dra. Ana Lima (@dra.ana.sorriso) • Instagram photos and videos")).toBe("Dra. Ana Lima");
    expect(extractBio(["Dra. Ana Lima", "dra.ana.sorriso", "180 publicações", "Dentista · CRO-SP 12345", "Agende pelo link", "Seguir", "Mensagem"], "dra.ana.sorriso", "Dra. Ana Lima")).toBe("Dentista · CRO-SP 12345\nAgende pelo link");
  });
});
