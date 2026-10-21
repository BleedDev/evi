/**
 * Discord's own icons. Each one is found in Discord's bundle by its exact path data, so it renders
 * through Discord's icon component (same sizes, same updates). The path data doubles as the fallback:
 * if Discord ever redraws or drops an icon, the copy below still matches the rest of its set.
 */
import type { ComponentType } from "react";

import { filters, find } from "../webpack/find";
import { wreq } from "../webpack/runtime";

interface IconDef {
    /** Discord's icon name, for reference */
    discord: string;
    paths: string[];
    evenOdd?: boolean;
}

const defs = {
    heart: { discord: "HeartIcon", paths: ["M12.47 21.73a.92.92 0 0 1-.94 0C9.43 20.48 1 15.09 1 8.75A5.75 5.75 0 0 1 6.75 3c2.34 0 3.88.9 5.25 2.26A6.98 6.98 0 0 1 17.25 3 5.75 5.75 0 0 1 23 8.75c0 6.34-8.42 11.73-10.53 12.98Z"] },
    bell: { discord: "BellIcon", paths: ["M9.7 2.89c.18-.07.32-.24.37-.43a2 2 0 0 1 3.86 0c.05.2.19.36.38.43A7 7 0 0 1 19 9.5v2.09c0 .12.05.24.13.33l1.1 1.22a3 3 0 0 1 .77 2.01v.28c0 .67-.34 1.29-.95 1.56-1.31.6-4 1.51-8.05 1.51-4.05 0-6.74-.91-8.05-1.5-.61-.28-.95-.9-.95-1.57v-.28a3 3 0 0 1 .77-2l1.1-1.23a.5.5 0 0 0 .13-.33V9.5a7 7 0 0 1 4.7-6.61ZM9.18 19.84A.16.16 0 0 0 9 20a3 3 0 1 0 6 0c0-.1-.09-.17-.18-.16a24.86 24.86 0 0 1-5.64 0Z"] },
    search: { discord: "MagnifyingGlassIcon", evenOdd: true, paths: ["M15.62 17.03a9 9 0 1 1 1.41-1.41l4.68 4.67a1 1 0 0 1-1.42 1.42l-4.67-4.68ZM17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"] },
    folder: { discord: "FolderIcon", paths: ["M2 5a3 3 0 0 1 3-3h3.93a2 2 0 0 1 1.66.9L12 5h7a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5Z"] },
    chevronDown: { discord: "ChevronSmallDownIcon", paths: ["M5.3 9.3a1 1 0 0 1 1.4 0l5.3 5.29 5.3-5.3a1 1 0 1 1 1.4 1.42l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.42Z"] },
    settings: { discord: "SettingsIcon", evenOdd: true, paths: ["M10.56 1.1c-.46.05-.7.53-.64.98.18 1.16-.19 2.2-.98 2.53-.8.33-1.79-.15-2.49-1.1-.27-.36-.78-.52-1.14-.24-.77.59-1.45 1.27-2.04 2.04-.28.36-.12.87.24 1.14.96.7 1.43 1.7 1.1 2.49-.33.8-1.37 1.16-2.53.98-.45-.07-.93.18-.99.64a11.1 11.1 0 0 0 0 2.88c.06.46.54.7.99.64 1.16-.18 2.2.19 2.53.98.33.8-.14 1.79-1.1 2.49-.36.27-.52.78-.24 1.14.59.77 1.27 1.45 2.04 2.04.36.28.87.12 1.14-.24.7-.95 1.7-1.43 2.49-1.1.8.33 1.16 1.37.98 2.53-.07.45.18.93.64.99a11.1 11.1 0 0 0 2.88 0c.46-.06.7-.54.64-.99-.18-1.16.19-2.2.98-2.53.8-.33 1.79.14 2.49 1.1.27.36.78.52 1.14.24.77-.59 1.45-1.27 2.04-2.04.28-.36.12-.87-.24-1.14-.96-.7-1.43-1.7-1.1-2.49.33-.8 1.37-1.16 2.53-.98.45.07.93-.18.99-.64a11.1 11.1 0 0 0 0-2.88c-.06-.46-.54-.7-.99-.64-1.16.18-2.2-.19-2.53-.98-.33-.8.14-1.79 1.1-2.49.36-.27.52-.78.24-1.14a11.07 11.07 0 0 0-2.04-2.04c-.36-.28-.87-.12-1.14.24-.7.96-1.7 1.43-2.49 1.1-.8-.33-1.16-1.37-.98-2.53.07-.45-.18-.93-.64-.99a11.1 11.1 0 0 0-2.88 0ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"] },
    star: { discord: "StarIcon", paths: ["M10.81 2.86c.38-1.15 2-1.15 2.38 0l1.89 5.83h6.12c1.2 0 1.71 1.54.73 2.25l-4.95 3.6 1.9 5.82a1.25 1.25 0 0 1-1.93 1.4L12 18.16l-4.95 3.6c-.98.7-2.3-.25-1.92-1.4l1.89-5.82-4.95-3.6a1.25 1.25 0 0 1 .73-2.25h6.12l1.9-5.83Z"] },
    trash: { discord: "TrashIcon", evenOdd: true, paths: ["M14.25 1c.41 0 .75.34.75.75V3h5.25c.41 0 .75.34.75.75v.5c0 .41-.34.75-.75.75H3.75A.75.75 0 0 1 3 4.25v-.5c0-.41.34-.75.75-.75H9V1.75c0-.41.34-.75.75-.75h4.5ZM5 7a1 1 0 0 1 1 .94l.72 11.5a.5.5 0 0 0 .5.47h9.56a.5.5 0 0 0 .5-.47L18 7.94a1 1 0 0 1 2 .12l-.72 11.5A2.5 2.5 0 0 1 16.78 22H7.22a2.5 2.5 0 0 1-2.5-2.44L4 8.06A1 1 0 0 1 5 7Zm4 3a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Zm6 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Z"] },
    chevronLeft: { discord: "ChevronSmallLeftIcon", paths: ["M14.7 5.3a1 1 0 0 1 0 1.4L9.41 12l5.3 5.3a1 1 0 1 1-1.42 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.42 0Z"] },
    chevronRight: { discord: "ChevronSmallRightIcon", paths: ["M9.3 5.3a1 1 0 0 0 0 1.4l5.29 5.3-5.3 5.3a1 1 0 1 0 1.42 1.4l6-6a1 1 0 0 0 0-1.4l-6-6a1 1 0 0 0-1.42 0Z"] },
    circleCheck: { discord: "CircleCheckIcon", evenOdd: true, paths: ["M12 23a11 11 0 1 0 0-22 11 11 0 0 0 0 22Zm5.7-13.3a1 1 0 0 0-1.4-1.4L10 14.58l-2.3-2.3a1 1 0 0 0-1.4 1.42l3 3a1 1 0 0 0 1.4 0l7-7Z"] },
    warning: { discord: "WarningIcon", evenOdd: true, paths: ["M10 3.1a2.37 2.37 0 0 1 4 0l8.71 14.75c.84 1.41-.26 3.15-2 3.15H3.29c-1.74 0-2.84-1.74-2-3.15L9.99 3.1Zm3.25 14.65a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0ZM13.06 14l.37-5.94a1 1 0 0 0-1-1.06h-.87a1 1 0 0 0-1 1.06l.38 5.94a1.06 1.06 0 0 0 2.12 0Z"] },
    circleError: { discord: "CircleErrorIcon", evenOdd: true, paths: ["M12 23a11 11 0 1 0 0-22 11 11 0 0 0 0 22Zm1.44-15.94L13.06 14a1.06 1.06 0 0 1-2.12 0l-.38-6.94a1 1 0 0 1 1-1.06h.88a1 1 0 0 1 1 1.06Zm-.19 10.69a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z"] },
    close: { discord: "XSmallIcon", paths: ["M17.3 18.7a1 1 0 0 0 1.4-1.4L13.42 12l5.3-5.3a1 1 0 0 0-1.42-1.4L12 10.58l-5.3-5.3a1 1 0 0 0-1.4 1.42L10.58 12l-5.3 5.3a1 1 0 1 0 1.42 1.4L12 13.42l5.3 5.3Z"] },
    closeLarge: { discord: "XLargeIcon", paths: ["M19.3 20.7a1 1 0 0 0 1.4-1.4L13.42 12l7.3-7.3a1 1 0 0 0-1.42-1.4L12 10.58l-7.3-7.3a1 1 0 0 0-1.4 1.42L10.58 12l-7.3 7.3a1 1 0 1 0 1.42 1.4L12 13.42l7.3 7.3Z"] },
    refresh: { discord: "RefreshIcon", paths: ["M21 2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 1 1 0-2h3.93A8 8 0 0 0 6.97 5.78a1 1 0 0 1-1.26-1.56A9.98 9.98 0 0 1 20 6V3a1 1 0 0 1 1-1ZM3 22a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h6a1 1 0 1 1 0 2H5.07a8 8 0 0 0 11.96 2.22 1 1 0 1 1 1.26 1.56A9.99 9.99 0 0 1 4 18v3a1 1 0 0 1-1 1Z"] },
    clock: { discord: "ClockIcon", evenOdd: true, paths: ["M12 23a11 11 0 1 0 0-22 11 11 0 0 0 0 22Zm1-18a1 1 0 1 0-2 0v7c0 .27.1.52.3.7l3 3a1 1 0 0 0 1.4-1.4L13 11.58V5Z"] },
    info: { discord: "CircleInformationIcon", evenOdd: true, paths: ["M23 12a11 11 0 1 1-22 0 11 11 0 0 1 22 0Zm-9.5-4.75a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm-.77 3.96a1 1 0 1 0-1.96-.42l-1.04 4.86a2.77 2.77 0 0 0 4.31 2.83l.24-.17a1 1 0 1 0-1.16-1.62l-.24.17a.77.77 0 0 1-1.2-.79l1.05-4.86Z"] },
    puzzle: { discord: "PuzzlePieceIcon", paths: ["M16 4a3 3 0 1 1-5.98-.31c.03-.35-.21-.69-.56-.69H7a3 3 0 0 0-3 3v2.5c0 .28-.23.5-.5.54a3 3 0 0 0 0 5.92c.27.04.5.26.5.54V18a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3h-2.46c-.35 0-.6.34-.56.69L16 4Z"] },
    palette: { discord: "PaintPaletteIcon", evenOdd: true, paths: ["M19 16h-5a2 2 0 0 0-2 2v2c0 1.66-1.37 3.04-2.96 2.6A11 11 0 1 1 23 12c0 2.2-2 4-4 4ZM13.5 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM17.25 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm-9-1.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm-3.75 7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"] },
    wrench: { discord: "WrenchIcon", paths: ["M7.8 15.77c.7.43 1.2 1.14 1.2 1.96V21a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-3.27c0-.82.5-1.53 1.2-1.96a8.06 8.06 0 0 0 .12-13.63c-.6-.39-1.32.09-1.32.8v5.98a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V2.94c0-.71-.72-1.19-1.32-.8a8.06 8.06 0 0 0 .12 13.63Z"] },
    code: { discord: "AngleBracketsIcon", paths: ["M9.6 7.8 4 12l5.6 4.2a1 1 0 0 1 .4.8v1.98c0 .21-.24.33-.4.2l-8.1-6.4a1 1 0 0 1 0-1.56l8.1-6.4c.16-.13.4-.01.4.2V7a1 1 0 0 1-.4.8ZM14.4 7.8 20 12l-5.6 4.2a1 1 0 0 0-.4.8v1.98c0 .21.24.33.4.2l8.1-6.4a1 1 0 0 0 0-1.56l-8.1-6.4a.25.25 0 0 0-.4.2V7a1 1 0 0 0 .4.8Z"] },
    beaker: { discord: "BeakerIcon", evenOdd: true, paths: ["M16 10.49V4a1 1 0 1 0 0-2H8a1 1 0 0 0 0 2v6.49a2 2 0 0 1-.5 1.33l-4.77 5.36A2.9 2.9 0 0 0 4.9 22h14.2a2.9 2.9 0 0 0 2.17-4.82l-4.76-5.36a2 2 0 0 1-.51-1.33ZM10 4v6.49a4 4 0 0 1-1.01 2.66l-1.35 1.51c1.14-.1 2.3.28 3.17 1.15l.13.13a3.73 3.73 0 0 0 4.56.56 3.73 3.73 0 0 1 2.02-.53L15 13.15A4 4 0 0 1 14 10.49V10h-1a1 1 0 1 1 0-2h1V7h-1a1 1 0 1 1 0-2h1V4h-4Z"] },
    copy: {
        discord: "CopyIcon",
        paths: [
            "M3 16a1 1 0 0 1-1-1v-5a8 8 0 0 1 8-8h5a1 1 0 0 1 1 1v.5a.5.5 0 0 1-.5.5H10a6 6 0 0 0-6 6v5.5a.5.5 0 0 1-.5.5H3Z",
            "M6 18a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4v-4h-3a5 5 0 0 1-5-5V6h-4a4 4 0 0 0-4 4v8Z",
            "M21.73 12a3 3 0 0 0-.6-.88l-4.25-4.24a3 3 0 0 0-.88-.61V9a3 3 0 0 0 3 3h2.73Z",
        ],
    },
    link: {
        discord: "LinkIcon",
        paths: [
            "M16.32 14.72a1 1 0 0 1 0-1.41l2.51-2.51a3.98 3.98 0 0 0-5.62-5.63l-2.52 2.51a1 1 0 0 1-1.41-1.41l2.52-2.52a5.98 5.98 0 0 1 8.45 8.46l-2.52 2.51a1 1 0 0 1-1.41 0ZM7.68 9.29a1 1 0 0 1 0 1.41l-2.52 2.51a3.98 3.98 0 1 0 5.63 5.63l2.51-2.52a1 1 0 0 1 1.42 1.42l-2.52 2.51a5.98 5.98 0 0 1-8.45-8.45l2.51-2.51a1 1 0 0 1 1.42 0Z",
            "M14.7 10.7a1 1 0 0 0-1.4-1.4l-4 4a1 1 0 1 0 1.4 1.4l4-4Z",
        ],
    },
    pencil: { discord: "PencilIcon", paths: ["m13.96 5.46 4.58 4.58a1 1 0 0 0 1.42 0l1.38-1.38a2 2 0 0 0 0-2.82l-3.18-3.18a2 2 0 0 0-2.82 0l-1.38 1.38a1 1 0 0 0 0 1.42ZM2.11 20.16l.73-4.22a3 3 0 0 1 .83-1.61l7.87-7.87a1 1 0 0 1 1.42 0l4.58 4.58a1 1 0 0 1 0 1.42l-7.87 7.87a3 3 0 0 1-1.6.83l-4.23.73a1.5 1.5 0 0 1-1.73-1.73Z"] },
    store: {
        discord: "ShopIcon",
        paths: [
            "M2.63 4.19A3 3 0 0 1 5.53 2H7a1 1 0 0 1 1 1v3.98a3.07 3.07 0 0 1-.3 1.35A2.97 2.97 0 0 1 4.98 10c-2 0-3.44-1.9-2.9-3.83l.55-1.98ZM10 2a1 1 0 0 0-1 1v4a3 3 0 0 0 3 3 3 3 0 0 0 3-2.97V3a1 1 0 0 0-1-1h-4ZM17 2a1 1 0 0 0-1 1v3.98a3.65 3.65 0 0 0 0 .05A2.95 2.95 0 0 0 19.02 10c2 0 3.44-1.9 2.9-3.83l-.55-1.98A3 3 0 0 0 18.47 2H17Z",
            "M21 11.42V19a3 3 0 0 1-3 3h-2.75a.25.25 0 0 1-.25-.25V16a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v5.75c0 .14-.11.25-.25.25H6a3 3 0 0 1-3-3v-7.58c0-.18.2-.3.37-.24a4.46 4.46 0 0 0 4.94-1.1c.1-.12.3-.12.4 0a4.49 4.49 0 0 0 6.58 0c.1-.12.3-.12.4 0a4.45 4.45 0 0 0 4.94 1.1c.17-.07.37.06.37.24Z",
        ],
    },
    download: { discord: "DownloadIcon", paths: ["M12 2a1 1 0 0 1 1 1v10.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V3a1 1 0 0 1 1-1ZM3 20a1 1 0 1 0 0 2h18a1 1 0 1 0 0-2H3Z"] },
    // Not in Discord's set: GitHub's own mark, where Discord's changelog has its social icons
    github: { discord: "(GitHub mark)", paths: ["M12 1C5.92 1 1 5.92 1 12c0 4.87 3.15 8.98 7.52 10.44.55.1.76-.23.76-.52 0-.26-.01-1.13-.01-2.05-2.77.51-3.48-.67-3.7-1.29-.12-.32-.66-1.3-1.13-1.56-.38-.2-.93-.71-.01-.73.86-.01 1.48.8 1.69 1.13.99 1.66 2.57 1.2 3.2.91.1-.71.39-1.2.7-1.47-2.45-.27-5-1.22-5-5.43 0-1.2.42-2.19 1.13-2.96-.11-.27-.5-1.4.11-2.91 0 0 .92-.29 3.02 1.13a10.2 10.2 0 0 1 2.75-.37c.94 0 1.87.12 2.75.37 2.1-1.43 3.03-1.13 3.03-1.13.6 1.51.22 2.64.11 2.91.7.77 1.13 1.75 1.13 2.96 0 4.22-2.57 5.16-5.02 5.43.4.34.74 1 .74 2.04 0 1.47-.01 2.65-.01 3.02 0 .29.2.63.75.52A11.01 11.01 0 0 0 23 12c0-6.08-4.92-11-11-11Z"] },
    // Evi's own: a console window with a prompt, for DevTools
    terminal: {
        discord: "(Evi's own)",
        evenOdd: true,
        paths: ["M2 6a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V6Zm4.3 3.7a1 1 0 0 1 1.4-1.4l3 3a1 1 0 0 1 0 1.4l-3 3a1 1 0 0 1-1.4-1.4L8.58 12 6.3 9.7ZM13 15a1 1 0 1 0 0 2h4a1 1 0 1 0 0-2h-4Z"],
    },
    // Not in Discord's set either: two people, for community plugins in the store
    people: {
        discord: "(Evi's own)",
        paths: [
            "M9 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z",
            "M2 18.5C2 15.46 5.13 13 9 13s7 2.46 7 5.5v.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-.5Z",
            "M16.5 5.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z",
            "M17.9 20H21a1 1 0 0 0 1-1v-.5c0-2.54-2.47-4.64-5.72-5.01A6.9 6.9 0 0 1 18 18.5v.5c0 .35-.04.68-.1 1Z",
        ],
    },
    // Evi's own too: a framed picture, for the wallpaper
    rotate: { discord: "RotateIcon", paths: ["M18 10h-6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-6a3 3 0 0 0-3-3Z", "M11 1.5 14.5 5 11 8.5V6H9.5A4.5 4.5 0 0 0 5 10.5V13H3v-2.5A6.5 6.5 0 0 1 9.5 4H11V1.5Z"] },
    image: {
        discord: "(Evi's own)",
        evenOdd: true,
        paths: [
            "M5 2a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3H5Zm0 2h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z",
            "M15.5 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
            "M5.5 18l3.8-5.07a1 1 0 0 1 1.6 0l2.1 2.8 1.2-1.4a1 1 0 0 1 1.52 0L18.5 18h-13Z",
        ],
    },
    analytics: {
        discord: "AnalyticsIcon",
        paths: ["M4 21a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4Zm7 0a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-2Zm7 0a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-2Z"],
    },
    mic: { discord: "MicrophoneIcon", paths: ["M12 2a4 4 0 0 0-4 4v4a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4Z", "M6 10a1 1 0 1 0-2 0 8 8 0 0 0 7 7.94V21H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-3.06A8 8 0 0 0 20 10a1 1 0 1 0-2 0 6 6 0 0 1-12 0Z"] },
    music: { discord: "MusicIcon", paths: ["M20 2.5a1 1 0 0 0-1.2-.98l-10 2A1 1 0 0 0 8 4.5v10.04A3.5 3.5 0 1 0 10 17.5V8.32l8-1.6v5.82A3.5 3.5 0 1 0 20 15.5v-13Z"] },
    tick: { discord: "CheckmarkLargeIcon", paths: ["M21.7 5.3a1 1 0 0 1 0 1.4l-12 12a1 1 0 0 1-1.4 0l-6-6a1 1 0 1 1 1.4-1.4L9 16.58l11.3-11.3a1 1 0 0 1 1.4 0Z"] },
} satisfies Record<string, IconDef>;

/** Names Evi used before switching to Discord's set, kept so existing callers keep working */
const aliases = {
    check: "circleCheck",
    cross: "close",
    reload: "refresh",
    chevron: "chevronRight",
} as const satisfies Record<string, keyof typeof defs>;

export type IconName = keyof typeof defs | keyof typeof aliases;

const resolve = (name: IconName): keyof typeof defs => (name in aliases ? aliases[name as keyof typeof aliases] : name as keyof typeof defs);

/** Discord's icon sizes, for the fallback when Discord's own button asks for one by name */
const namedSizes: Record<string, number> = { xxs: 12, xs: 16, sm: 18, refresh_sm: 20, md: 24, lg: 32 };

function fallback(def: IconDef) {
    return function EviIcon({ size, width, height, className, style }: { size?: string | number; width?: number; height?: number; className?: string; style?: React.CSSProperties; }) {
        const px = width ?? height ?? (typeof size === "number" ? size : namedSizes[size ?? "md"] ?? 24);
        return (
            <svg className={className} style={style} width={px} height={px} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                {def.paths.map(d => <path key={d} fill="currentColor" fillRule={def.evenOdd ? "evenodd" : undefined} clipRule={def.evenOdd ? "evenodd" : undefined} d={d} />)}
            </svg>
        );
    };
}

const cache = new Map<string, ComponentType<any>>();

/** Discord's component for an icon, found by its path data, or Evi's copy of the same icon */
export function iconComponent(name: IconName): ComponentType<any> {
    const key = resolve(name);
    const cached = cache.get(key);
    if (cached) return cached;
    const def: IconDef = defs[key];
    const live = wreq ? find(filters.componentByCode(`"${def.paths[0]}"`)) : undefined;
    const component = live ?? fallback(def);
    // Before webpack is up we can't know yet, so don't remember the fallback
    if (wreq) cache.set(key, component);
    return component;
}

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string; }) {
    const Component = iconComponent(name);
    // "custom" isn't one of Discord's size names, so its icons take width and height as given
    return <Component size="custom" width={size} height={size} color="currentColor" className={className} aria-hidden="true" />;
}
