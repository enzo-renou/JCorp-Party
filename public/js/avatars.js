// Avatars générés localement (plus de dépendance à DiceBear) :
// une même "graine" donne toujours le même petit robot, chez tous les joueurs.
(function () {
    function hash(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }
    function rng(seed) {
        let a = hash(seed);
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function svg(seed) {
        const r = rng(String(seed));
        const pick = (n) => Math.floor(r() * n);
        const hue = pick(360);
        const bg = `hsl(${hue},75%,88%)`;
        const body = `hsl(${(hue + 150 + pick(60)) % 360},65%,58%)`;
        const dark = `hsl(${(hue + 150) % 360},45%,22%)`;
        const accent = `hsl(${(hue + 40 + pick(80)) % 360},85%,60%)`;

        const headShape = pick(3);
        const eyes = pick(6);
        const mouth = pick(5);
        const top = pick(5);
        const ears = pick(2) === 0;
        const cheeks = pick(2) === 0;

        let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${bg}"/>`;

        // Dessus de la tête
        if (top === 0) s += `<line x1="50" y1="30" x2="50" y2="17" stroke="${dark}" stroke-width="3"/><circle cx="50" cy="14" r="6" fill="${accent}"/>`;
        if (top === 1) s += `<line x1="38" y1="31" x2="30" y2="15" stroke="${dark}" stroke-width="3"/><circle cx="29" cy="13" r="5" fill="${accent}"/><line x1="62" y1="31" x2="70" y2="15" stroke="${dark}" stroke-width="3"/><circle cx="71" cy="13" r="5" fill="${accent}"/>`;
        if (top === 3) s += `<path d="M24 36 Q50 8 76 36 Z" fill="${accent}"/><rect x="20" y="33" width="60" height="6" rx="3" fill="${dark}"/>`;
        if (top === 4) s += `<path d="M28 34 L22 14 L40 28 Z" fill="${accent}"/><path d="M72 34 L78 14 L60 28 Z" fill="${accent}"/>`;

        // Oreilles
        if (ears) s += `<rect x="12" y="50" width="10" height="20" rx="4" fill="${dark}"/><rect x="78" y="50" width="10" height="20" rx="4" fill="${dark}"/>`;

        // Tête
        if (headShape === 0) s += `<rect x="22" y="30" width="56" height="58" rx="14" fill="${body}"/>`;
        else if (headShape === 1) s += `<ellipse cx="50" cy="59" rx="29" ry="29" fill="${body}"/>`;
        else s += `<path d="M30 30 H70 L80 44 V74 L70 88 H30 L20 74 V44 Z" fill="${body}"/>`;

        // Joues
        if (cheeks) s += `<circle cx="32" cy="68" r="5" fill="#fff" opacity="0.35"/><circle cx="68" cy="68" r="5" fill="#fff" opacity="0.35"/>`;

        // Yeux
        if (eyes === 0) s += `<circle cx="38" cy="54" r="5" fill="${dark}"/><circle cx="62" cy="54" r="5" fill="${dark}"/>`;
        if (eyes === 1) s += `<circle cx="38" cy="54" r="9" fill="#fff"/><circle cx="62" cy="54" r="9" fill="#fff"/><circle cx="40" cy="55" r="4.5" fill="${dark}"/><circle cx="60" cy="55" r="4.5" fill="${dark}"/>`;
        if (eyes === 2) s += `<rect x="26" y="46" width="48" height="14" rx="7" fill="${dark}"/><rect x="32" y="50" width="12" height="6" rx="3" fill="${accent}"/><rect x="56" y="50" width="12" height="6" rx="3" fill="${accent}"/>`;
        if (eyes === 3) s += `<circle cx="50" cy="54" r="12" fill="#fff"/><circle cx="50" cy="54" r="6" fill="${dark}"/>`;
        if (eyes === 4) s += `<path d="M31 57 Q38 47 45 57" stroke="${dark}" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M55 57 Q62 47 69 57" stroke="${dark}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
        if (eyes === 5) s += `<path d="M30 46 L46 52" stroke="${dark}" stroke-width="4" stroke-linecap="round"/><path d="M70 46 L54 52" stroke="${dark}" stroke-width="4" stroke-linecap="round"/><circle cx="38" cy="58" r="4" fill="${dark}"/><circle cx="62" cy="58" r="4" fill="${dark}"/>`;

        // Bouche
        if (mouth === 0) s += `<path d="M38 72 Q50 82 62 72" stroke="${dark}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
        if (mouth === 1) s += `<line x1="40" y1="75" x2="60" y2="75" stroke="${dark}" stroke-width="4" stroke-linecap="round"/>`;
        if (mouth === 2) s += `<ellipse cx="50" cy="76" rx="8" ry="6" fill="${dark}"/>`;
        if (mouth === 3) s += `<path d="M36 76 L42 70 L48 76 L54 70 L60 76 L64 72" stroke="${dark}" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
        if (mouth === 4) s += `<rect x="38" y="70" width="24" height="10" rx="3" fill="#fff" stroke="${dark}" stroke-width="2.5"/><line x1="46" y1="70" x2="46" y2="80" stroke="${dark}" stroke-width="2"/><line x1="54" y1="70" x2="54" y2="80" stroke="${dark}" stroke-width="2"/>`;

        return s + '</svg>';
    }

    function url(seed) {
        return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg(seed || 'default'));
    }
    function randomSeed() {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let out = '';
        const arr = new Uint32Array(8);
        (window.crypto || window.msCrypto).getRandomValues(arr);
        for (let i = 0; i < 8; i++) out += chars[arr[i] % chars.length];
        return out;
    }

    window.Avatars = { url, randomSeed };
})();
