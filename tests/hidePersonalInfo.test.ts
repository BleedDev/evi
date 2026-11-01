import { describe, expect, test } from "bun:test";

import { collectKnown, detectSensitive, emptyKnown, isTextField } from "../plugins/hide-personal-info/detect";

describe("detectSensitive patterns", () => {
    test("emails, masked ones too", () => {
        for (const t of ["alican@gmail.com", "Email: some.one+tag@mail.example.co.uk", "*********@gmail.com", "ünal@örnek.com.tr"]) {
            expect(detectSensitive(t)).toBe("email");
        }
    });

    test("phone numbers, international and national", () => {
        for (const t of [
            "+90 532 123 45 67",
            "+1 (555) 123-4567",
            "+44 20 7946 0958",
            "+905321234567",
            "0049 30 123456",
            "(555) 123-4567",
            "555-123-4567",
            "555.123.4567",
            "0532 123 45 67",
            "Phone: 020 7946 0958",
        ]) {
            expect(detectSensitive(t)).toBe("phone");
        }
    });

    test("card and phone masks", () => {
        for (const t of ["•••• 1234", "Visa •••• •••• •••• 4242", "**** **** **** 1234", "*******6789", "Mastercard ending in 4444"]) {
            expect(detectSensitive(t)).toBe("card");
        }
    });

    test("IPv4 and IPv6", () => {
        for (const t of ["192.168.1.10", "IP 8.8.8.8 · 2 hours ago", "2001:db8::ff00:42:8329", "fe80::1ff:fe23:4567:890a", "2001:0db8:85a3:0000:0000:8a2e:0370:7334"]) {
            expect(detectSensitive(t)).toBe("ip");
        }
    });

    test("no false positives on plain text, times, dates, versions, counts and ids", () => {
        for (const t of [
            "",
            "   ",
            "My Account",
            "Edit User Profile",
            "Two-Factor Authentication",
            "Last active 2 hours ago",
            "12:30",
            "12:30:45",
            "Today at 4:05 PM",
            "2026-09-27",
            "27.09.2026",
            "09/27/26",
            "2026-09-27 12:30:45",
            "Version 0.2.0",
            "v1.2.3",
            "Stable 345678 (a1b2c3d) Host 1.0.9187 x64 (65432)",
            "Electron 37.2.1",
            "1234567",
            "123456789012345678",
            "Member since Jan 1, 2020",
            "Nitro · $9.99/month",
            "3 of 5 · 60%",
            "::",
            "a:b:c",
            "Istanbul · 2 hours ago",
            "Windows · Discord Client",
            "Price 1,299.00",
        ]) {
            expect(detectSensitive(t)).toBeNull();
        }
    });
});

describe("known values", () => {
    const known = collectKnown({
        user: { email: "me@x.io", phone: "+905321234567", username: "bleeddev", discriminator: "0" },
        connectedAccounts: [{ name: "BleedGH" }, { name: "ab" }],
        authorizedApps: [{ application: { name: "Spotify" } }],
        sessions: [{ client_info: { location: "Istanbul, Turkey" } }],
        paymentSources: { p1: { billingAddress: { name: "Alican Bal", line1: "Bagdat Cd 12", postalCode: "34000", country: "TR" } } },
    });

    test("collects from sources", () => {
        expect(known.substrings).toContain("me@x.io");
        expect(known.substrings).toContain("bleeddev");
        expect(known.substrings).toContain("Istanbul, Turkey");
        expect(known.substrings).not.toContain("TR");
        expect(known.exact).toEqual(["Spotify"]);
        expect(known.phones).toEqual(["+905321234567"]);
    });

    test("matches the user's own values", () => {
        expect(detectSensitive("bleeddev", known)).toBe("known");
        expect(detectSensitive("Signed in as BleedDev", known)).toBe("known");
        expect(detectSensitive("BleedGH", known)).toBe("known");
        expect(detectSensitive("Istanbul, Turkey · 2 hours ago", known)).toBe("known");
        expect(detectSensitive("Alican Bal", known)).toBe("known");
        expect(detectSensitive("Spotify", known)).toBe("known");
        expect(detectSensitive("5321234567", known)).toBe("known");
        expect(detectSensitive("532 123 45 67", known)).toBe("known");
    });

    test("whole words only, exact names only as the whole text, short values ignored", () => {
        expect(detectSensitive("bleeddevs are cool", known)).toBeNull();
        expect(detectSensitive("Connect Spotify to show what you listen to", known)).toBeNull();
        expect(detectSensitive("about", known)).toBeNull();
        expect(detectSensitive("My Account", known)).toBeNull();
    });

    test("works with nothing known and with missing sources", () => {
        expect(collectKnown({})).toEqual(emptyKnown());
        expect(collectKnown({ user: null, paymentSources: null })).toEqual(emptyKnown());
    });
});

describe("text boxes", () => {
    test("text, email, phone, search and URL inputs and text areas are looked at", () => {
        for (const [tag, type] of [["INPUT", "text"], ["input", "email"], ["INPUT", "tel"], ["INPUT", "search"], ["INPUT", "URL"], ["INPUT", ""], ["INPUT", undefined], ["TEXTAREA", undefined]] as const) {
            expect(isTextField(tag, type)).toBe(true);
        }
    });

    test("passwords, checkboxes and other controls aren't", () => {
        for (const type of ["password", "checkbox", "radio", "range", "hidden", "file", "color", "number"]) {
            expect(isTextField("INPUT", type)).toBe(false);
        }
        expect(isTextField("DIV")).toBe(false);
        expect(isTextField("SELECT")).toBe(false);
    });

    test("what a text box holds in settings is caught like text", () => {
        const known = collectKnown({
            user: { email: "me@x.io", phone: "+905321234567", username: "bleeddev" },
            paymentSources: { p1: { billingAddress: { line1: "Bagdat Cd 12", city: "Istanbul" } } },
        });
        expect(detectSensitive("me@x.io", known)).toBe("known");
        expect(detectSensitive("someone.else@mail.com", known)).toBe("email");
        expect(detectSensitive("0532 123 45 67", known)).toBe("known");
        expect(detectSensitive("Bagdat Cd 12", known)).toBe("known");
        expect(detectSensitive("Istanbul", known)).toBe("known");
        expect(detectSensitive("Search", known)).toBeNull();
        expect(detectSensitive("", known)).toBeNull();
    });
});
