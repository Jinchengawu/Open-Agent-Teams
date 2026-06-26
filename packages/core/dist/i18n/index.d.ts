export type Locale = 'zh' | 'en';
export declare function normalizeLocale(value?: string | null): Locale;
export declare function isSupportedLocale(value: string): value is Locale;
export declare function negotiateLocale(input: {
    queryLang?: string | null;
    acceptLanguage?: string | string[] | null;
    fallback?: Locale;
}): Locale;
export type LocalizedText = {
    zh: string;
    en: string;
};
export declare function pickText(text: LocalizedText, locale: Locale): string;
export declare function localizeAgent<T extends Record<string, any>>(agent: T, locale: Locale): T & {
    displayName: string;
    displayLabel: string;
    locale: Locale;
    translations?: {
        name: LocalizedText;
        label: LocalizedText;
    };
};
export declare function localizeAgents<T extends Record<string, any>>(agents: T[], locale: Locale): (T & {
    displayName: string;
    displayLabel: string;
    locale: Locale;
    translations?: {
        name: LocalizedText;
        label: LocalizedText;
    };
})[];
//# sourceMappingURL=index.d.ts.map