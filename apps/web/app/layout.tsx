import "./globals.css";
import {MotionUI} from "@/components/MotionUI";
import type {Metadata} from "next";
export const metadata:Metadata={title:"TradeQuest Backtest",description:"Standalone chart replay and simulated trading"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="th"><body><MotionUI>{children}</MotionUI></body></html>;}
