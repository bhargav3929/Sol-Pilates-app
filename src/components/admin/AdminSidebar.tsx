"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import {
    SquaresFour,
    CalendarDots,
    MapPin,
    UsersThree,
    UserCircle,
    BookmarkSimple,
    ChartBar,
    EnvelopeSimple,
    ChatCircle,
    GearSix,
    SignOut,
    CaretLeft,
    X,
    Star,
    CheckSquare,
    Megaphone,
    Tray,
    Tag,
    Images,
} from "@phosphor-icons/react"
import { useState } from "react"
import { useAdminAuthStore } from "@fitconnect/shared/stores/adminAuthStore"
import { useUIStore } from "@fitconnect/shared/stores/uiStore"
import { useRouter } from "next/navigation"

const NAV_ITEMS = [
    { label: "Dashboard", icon: SquaresFour, href: "/admin/dashboard" },
    { label: "Check-In", icon: CheckSquare, href: "/admin/checkin" },
    { label: "Bookings", icon: BookmarkSimple, href: "/admin/bookings" },
    { label: "Classes", icon: CalendarDots, href: "/admin/classes" },
    { label: "Members", icon: UserCircle, href: "/admin/members" },
    { label: "Plans & Pricing", icon: Tag, href: "/admin/plans" },
    { label: "Leads", icon: EnvelopeSimple, href: "/admin/leads" },
    { label: "Messages", icon: Tray, href: "/admin/messages" },
    { label: "Waitlist", icon: Star, href: "/admin/waitlist" },
    { label: "Trainers", icon: UsersThree, href: "/admin/trainers" },
    { label: "Facility", icon: MapPin, href: "/admin/locations" },
    { label: "Website Images", icon: Images, href: "/admin/media" },
    { label: "Feedback", icon: ChatCircle, href: "/admin/feedback" },
    { label: "Announcements", icon: Megaphone, href: "/admin/notifications" },
    { label: "Reports", icon: ChartBar, href: "/admin/reports" },
]

const BOTTOM_ITEMS = [
    { label: "Settings", icon: GearSix, href: "/admin/settings" },
]

export function AdminSidebar() {
    const pathname = usePathname()
    const router = useRouter()
    const { logoutAdmin } = useAdminAuthStore()
    const { isSidebarOpen, setSidebarOpen } = useUIStore()
    const [collapsed, setCollapsed] = useState(false)

    const handleLogout = async () => {
        await logoutAdmin()
        router.push('/')
    }

    const sidebarContent = (
        <>
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-7 pb-5">
                <Link href="/admin/dashboard" className="group">
                    <Image
                        src="/images/sol-logo-terra.png"
                        alt="SOL Pilates Studio"
                        width={400}
                        height={400}
                        className={`${collapsed ? 'h-10 w-10 object-cover object-left' : 'h-14'} w-auto group-hover:opacity-80 transition-opacity duration-300`}
                    />
                </Link>
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className="hidden lg:flex w-7 h-7 items-center justify-center text-peach-400/40 hover:text-peach-200 transition-colors hover:bg-peach-200/5 rounded-lg"
                >
                    <CaretLeft weight="bold" className={`w-3.5 h-3.5 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`} />
                </button>
                <button
                    onClick={() => setSidebarOpen(false)}
                    className="lg:hidden w-7 h-7 flex items-center justify-center text-peach-400/40 hover:text-peach-200 transition-colors"
                >
                    <X weight="bold" className="w-4 h-4" />
                </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto scrollbar-none">
                {!collapsed && (
                    <p className="text-peach-400/25 text-[10px] font-bold tracking-[0.2em] uppercase px-3 mb-3">Overview</p>
                )}
                {NAV_ITEMS.map((item) => {
                    const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative ${
                                isActive
                                    ? 'bg-terra-400 text-peach-50 shadow-lg shadow-terra-400/20'
                                    : 'text-peach-400/50 hover:text-peach-200 hover:bg-peach-200/5'
                            }`}
                        >
                            <item.icon
                                weight={isActive ? "fill" : "regular"}
                                className="w-[20px] h-[20px] flex-shrink-0"
                            />
                            {!collapsed && (
                                <span className={`text-sm ${isActive ? 'font-bold' : 'font-medium'}`}>
                                    {item.label}
                                </span>
                            )}
                        </Link>
                    )
                })}
            </nav>

            {/* Bottom Section */}
            <div className="py-3 px-3 border-t border-peach-200/6 space-y-0.5">
                {BOTTOM_ITEMS.map((item) => {
                    const isActive = pathname === item.href
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setSidebarOpen(false)}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                                isActive
                                    ? 'bg-terra-400 text-peach-50 shadow-lg shadow-terra-400/20'
                                    : 'text-peach-400/50 hover:text-peach-200 hover:bg-peach-200/5'
                            }`}
                        >
                            <item.icon weight={isActive ? "fill" : "regular"} className="w-[20px] h-[20px] flex-shrink-0" />
                            {!collapsed && <span className={`text-sm ${isActive ? 'font-bold' : 'font-medium'}`}>{item.label}</span>}
                        </Link>
                    )
                })}
                <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-peach-400/30 hover:text-red-500 hover:bg-red-500/10 transition-all duration-200"
                >
                    <SignOut weight="regular" className="w-[20px] h-[20px] flex-shrink-0" />
                    {!collapsed && <span className="text-sm font-medium">Logout</span>}
                </button>
            </div>
        </>
    )

    return (
        <>
            {/* Desktop Sidebar */}
            <aside
                className={`fixed left-0 top-0 bottom-0 z-40 bg-warmDark-900/95 backdrop-blur-xl border-r border-peach-200/6 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hidden lg:flex flex-col ${
                    collapsed ? 'w-20' : 'w-72'
                }`}
            >
                {sidebarContent}
            </aside>

            {/* Mobile Sidebar */}
            <AnimatePresence>
                {isSidebarOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setSidebarOpen(false)}
                            className="fixed inset-0 z-40 bg-warmDark-800/60 backdrop-blur-sm lg:hidden"
                        />
                        <motion.aside
                            initial={{ x: "-100%" }}
                            animate={{ x: 0 }}
                            exit={{ x: "-100%" }}
                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                            className="fixed left-0 top-0 bottom-0 z-50 w-72 bg-warmDark-900 border-r border-peach-200/6 flex flex-col lg:hidden"
                        >
                            {sidebarContent}
                        </motion.aside>
                    </>
                )}
            </AnimatePresence>
        </>
    )
}
