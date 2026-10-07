"use client";
import { copy as i18nCopy } from "../../lib/i18n";

import { ConversationActions } from "./ChatHistoryActions";
import { ConversationSourceIcon } from "./ConversationSourceIcon";
import Link from "next/link";
import { useEffect,useState } from "react";
import { useLocale } from "next-intl";
import { usePathname } from "next/navigation";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {ChevronDownIcon,CheckIcon} from "../icons";
import styles from "./WorkbenchChrome.module.css";
import { callApi } from "../../lib/clientApi";
import { statusLabel,taskEntryTitle,type TaskStatus } from "../../lib/workbench";
import { shortTaskStatus } from "./taskStatusCopy";

type Entry={session_id:string;title:string;source?:string;workbench_status?:TaskStatus;match?:{message_id:string;snippet:string}};
export function TaskList(){
  const zh=useLocale().startsWith("zh"),pathname=usePathname();
  const [expanded,setExpanded]=useState(false);
  const [filter,setFilter]=useState("all"),[rows,setRows]=useState<Entry[]>([]),[error,setError]=useState(false),[loading,setLoading]=useState(true);
  useEffect(()=>{
    let stopped=false;let timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
    async function refresh(){try{
      const params=new URLSearchParams({view:"workbench",state:filter,limit:"50"});
      const result=await callApi<{sessions:Entry[]}>("/agent/sessions?"+params,{signal:controller.signal});
      if(!Array.isArray(result.sessions))throw new Error("invalid_sessions");
      if(!stopped){setRows(result.sessions.map(row=>({...row,title:taskEntryTitle(row)})));setError(false);}
    }catch{if(!stopped)setError(true);}finally{if(!stopped){setLoading(false);timer=setTimeout(refresh,document.hidden?15000:2000);}}}
    timer=setTimeout(refresh,0);return()=>{stopped=true;controller.abort();clearTimeout(timer);};
  },[filter]);
  const filters=[['all',i18nCopy(zh, "copy.components_chat_TaskList.001")],['active',i18nCopy(zh, "copy.components_chat_TaskList.002")],['attention',i18nCopy(zh, "copy.components_chat_TaskList.003")],['completed',i18nCopy(zh, "copy.components_chat_TaskList.004")]];
  return <section className={styles.tasks} aria-label={i18nCopy(zh, "copy.components_chat_TaskList.005")} data-testid="workbench-tasks">
    <div className={styles.tasksHeader}><span className={styles.tasksHeading}>{i18nCopy(zh, "copy.components_chat_TaskList.006")}</span>
      <Menu.Root><Menu.Trigger asChild><button type="button" className={styles.filter} aria-label={i18nCopy(zh, "copy.components_chat_TaskList.007")}>{filters.find(([id])=>id===filter)?.[1]}<ChevronDownIcon size={12}/></button></Menu.Trigger>
        <Menu.Portal><Menu.Content className="ui-select-menu min-w-40" align="end" sideOffset={5}><Menu.RadioGroup value={filter} onValueChange={setFilter}>{filters.map(([value,label])=><Menu.RadioItem key={value} value={value} className="ui-select-option"><span className="flex-1">{label}</span><Menu.ItemIndicator><CheckIcon size={14}/></Menu.ItemIndicator></Menu.RadioItem>)}</Menu.RadioGroup></Menu.Content></Menu.Portal>
      </Menu.Root>
    </div>
    {error&&<p role="status" className={styles.listHint}>{i18nCopy(zh, "copy.components_chat_TaskList.008")}</p>}
    {!error&&loading&&<p className={styles.listHint}>{i18nCopy(zh, "copy.components_chat_TaskList.009")}</p>}
    {!error&&!loading&&!rows.length&&<p className={styles.listHint}>{i18nCopy(zh, "copy.components_chat_TaskList.010")}</p>}
    {(expanded ? rows : rows.slice(0,Math.max(6,rows.findIndex(row=>pathname==="/chat/"+encodeURIComponent(row.session_id))+1))).map(row=>{const label=row.workbench_status?statusLabel(row.workbench_status,zh):"";const title=row.title||(i18nCopy(zh, "copy.components_chat_TaskList.011"));return <div key={row.session_id} className={"group "+styles.taskRow} data-active={pathname==="/chat/"+row.session_id}>
      <Link href={"/chat/"+encodeURIComponent(row.session_id)} aria-current={pathname==="/chat/"+row.session_id?"page":undefined} className={styles.task} title={[title,label,row.source].filter(Boolean).join(" · ")}>
        <ConversationSourceIcon source={row.source} size={16} className={styles.taskIcon}/>
        <span className={styles.taskText}><span className={styles.taskTitle}>{title}</span>{row.workbench_status&&<span className={styles.taskStatus} data-attention={row.workbench_status.needs_attention || !!row.workbench_status.waiting_for}>{shortTaskStatus(row.workbench_status,zh)}</span>}</span>
      </Link><div className={styles.taskActions}><ConversationActions id={row.session_id} title={title}/></div>
    </div>;})}
    {rows.length>6&&<button type="button" className={styles.showMore} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?(i18nCopy(zh, "copy.components_chat_TaskList.012")):(i18nCopy(zh, "copy.components_chat_TaskList.013"))}</button>}
  </section>;
}
