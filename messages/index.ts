import enAccount from "./en/account.json";
import enAuth from "./en/auth.json";
import enCommon from "./en/common.json";
import enDecisions from "./en/decisions.json";
import enMarketing from "./en/marketing.json";
import enMemory from "./en/memory.json";
import enSettings from "./en/settings.json";
import enShell from "./en/shell.json";
import enTaskDetail from "./en/taskDetail.json";
import enTasks from "./en/tasks.json";
import esAccount from "./es/account.json";
import esAuth from "./es/auth.json";
import esCommon from "./es/common.json";
import esDecisions from "./es/decisions.json";
import esMarketing from "./es/marketing.json";
import esMemory from "./es/memory.json";
import esSettings from "./es/settings.json";
import esShell from "./es/shell.json";
import esTaskDetail from "./es/taskDetail.json";
import esTasks from "./es/tasks.json";

/**
 * Every namespace, per locale. One JSON file per namespace per locale so
 * screens can be translated in parallel without touching each other's
 * files; see `messages/README.md` for which screens own which namespace.
 */
export const CATALOGS = {
  en: {
    common: enCommon,
    shell: enShell,
    settings: enSettings,
    tasks: enTasks,
    taskDetail: enTaskDetail,
    decisions: enDecisions,
    memory: enMemory,
    account: enAccount,
    auth: enAuth,
    marketing: enMarketing,
  },
  es: {
    common: esCommon,
    shell: esShell,
    settings: esSettings,
    tasks: esTasks,
    taskDetail: esTaskDetail,
    decisions: esDecisions,
    memory: esMemory,
    account: esAccount,
    auth: esAuth,
    marketing: esMarketing,
  },
};
