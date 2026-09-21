"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Loader2, User, Eye, EyeOff, ArrowLeft, Mail, Lock, UserPlus, X, Phone } from "lucide-react"
import Link from "next/link"
import Image from "next/image"

import { Button } from "@/components/ui/button"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { useClientAuthStore } from "@fitconnect/shared/stores/clientAuthStore"
import { toast } from "sonner"
import { COLORS, withAlpha } from "@fitconnect/shared/theme"
import { sendPasswordResetEmail } from "firebase/auth"
import { auth } from "@fitconnect/shared/firebase/config"
import { isValidPhone, PHONE_VALIDATION_MESSAGE } from "@fitconnect/shared/utils/phone"
import { trackPixel } from "@/lib/meta-pixel"

const loginSchema = z.object({
    email: z.string().email("Please enter a valid email address"),
    password: z.string().min(1, "Password is required"),
})

const signupSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().email("Please enter a valid email address"),
    phone: z.string().refine(isValidPhone, PHONE_VALIDATION_MESSAGE),
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
})

type LoginValues = z.infer<typeof loginSchema>
type SignupValues = z.infer<typeof signupSchema>

export function UserLoginContent() {
    const [isLoading, setIsLoading] = useState(false)
    const [isGoogleLoading, setIsGoogleLoading] = useState(false)
    const [showPassword, setShowPassword] = useState(false)
    const [forgotOpen, setForgotOpen] = useState(false)
    const [forgotEmail, setForgotEmail] = useState("")
    const [forgotLoading, setForgotLoading] = useState(false)
    const [forgotSent, setForgotSent] = useState(false)
    const router = useRouter()
    const searchParams = useSearchParams()
    const [activeTab, setActiveTab] = useState<'login' | 'signup'>(
        searchParams.get('tab') === 'signup' ? 'signup' : 'login'
    )
    const { loginClient, signupClient, googleSignIn, isAuthenticated, isLoading: authLoading, initAuth } = useClientAuthStore()

    // Only allow internal paths to prevent open-redirect via ?returnTo=//evil.com
    const rawReturnTo = searchParams.get('returnTo')
    const returnTo = rawReturnTo && rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//')
        ? rawReturnTo
        : '/user/dashboard'

    useEffect(() => {
        const unsubscribe = initAuth()
        return () => unsubscribe()
    }, [initAuth])

    useEffect(() => {
        if (!authLoading && isAuthenticated) {
            router.replace(returnTo)
        }
    }, [authLoading, isAuthenticated, returnTo, router])

    const loginForm = useForm<LoginValues>({
        resolver: zodResolver(loginSchema),
        defaultValues: { email: "", password: "" },
    })

    const signupForm = useForm<SignupValues>({
        resolver: zodResolver(signupSchema),
        defaultValues: { name: "", email: "", phone: "", password: "", confirmPassword: "" },
    })

    async function onLogin(values: LoginValues) {
        setIsLoading(true)
        const result = await loginClient(values.email, values.password)
        if (result.success) {
            toast.success("Welcome back!", {
                description: "Successfully logged in to your member account.",
            })
            router.push(returnTo)
        } else {
            toast.error("Login failed", {
                description: result.error,
            })
        }
        setIsLoading(false)
    }

    async function onSignup(values: SignupValues) {
        setIsLoading(true)
        const result = await signupClient(values.email, values.password, values.name, values.phone)
        if (result.success) {
            trackPixel("CompleteRegistration", { content_name: "email" })
            toast.success("Account created!", {
                description: "Welcome to SOL Pilates Studio.",
            })
            router.push(returnTo)
        } else {
            toast.error("Signup failed", {
                description: result.error,
            })
        }
        setIsLoading(false)
    }

    async function onGoogleSignIn() {
        setIsGoogleLoading(true)
        const result = await googleSignIn()
        if (result.success) {
            if (result.isNewUser) trackPixel("CompleteRegistration", { content_name: "google" })
            toast.success("Welcome!", {
                description: "Successfully signed in with Google.",
            })
            router.push(returnTo)
        } else {
            toast.error("Google sign-in failed", {
                description: result.error,
            })
        }
        setIsGoogleLoading(false)
    }

    async function handleForgotPassword() {
        if (!forgotEmail.trim()) return
        setForgotLoading(true)
        try {
            await sendPasswordResetEmail(auth, forgotEmail.trim())
            setForgotSent(true)
        } catch {
            toast.error("Could not send reset email", {
                description: "Check the email address and try again.",
            })
        }
        setForgotLoading(false)
    }

    if (authLoading || isAuthenticated) {
        return (
            <main className="min-h-screen bg-peach-200 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-8 h-8 border-2 border-peach-400/30 border-t-terra-400 rounded-full animate-spin" />
                    <p className="text-olive-300 text-sm tracking-wider">REDIRECTING...</p>
                </div>
            </main>
        )
    }

    return (
        <div className="min-h-screen bg-peach-200 flex">
            {/* Left Panel - Decorative (dark feature panel) */}
            <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-terra-400/15 via-warmDark-800 to-warmDark-900" />

                <div
                    className="absolute inset-0 opacity-20"
                    style={{
                        backgroundImage: `linear-gradient(${withAlpha(COLORS.peach[500], 0.10)} 1px, transparent 1px), linear-gradient(90deg, ${withAlpha(COLORS.peach[500], 0.10)} 1px, transparent 1px)`,
                        backgroundSize: '60px 60px'
                    }}
                />

                <div className="relative z-10 flex flex-col justify-between p-16">
                    <div>
                        <Link href="/" className="inline-flex items-center gap-3 group">
                            <ArrowLeft className="w-7 h-7 text-peach-200 group-hover:text-white transition-colors" />
                            <Image src="/images/sol-logo-terra.png" alt="SOL Pilates Studio" width={400} height={400} className="h-24 w-auto" />
                        </Link>
                    </div>

                    <div>
                        <motion.div
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.8 }}
                        >
                            <h1 className="text-6xl font-black text-peach-200 leading-tight tracking-normal mt-4 font-display">
                                MEMBER<br />
                                ACCESS<br />
                                PORTAL
                            </h1>
                            <p className="text-peach-400 mt-6 max-w-md tracking-wider text-sm">
                                Track your progress, book classes, and manage your membership journey all in one place.
                            </p>
                        </motion.div>
                    </div>

                    <div className="text-peach-400/50 text-xs tracking-wider">
                        SOL MEMBER v1.0
                    </div>
                </div>

                <div className="absolute bottom-0 right-0 w-64 h-64">
                    <svg viewBox="0 0 200 200" className="w-full h-full opacity-10">
                        <circle cx="100" cy="100" r="80" stroke="currentColor" strokeWidth="1" fill="none" className="text-peach-200" />
                        <circle cx="100" cy="100" r="60" stroke="currentColor" strokeWidth="1" fill="none" className="text-peach-200" />
                    </svg>
                </div>
            </div>

            {/* Right Panel - Login/Signup Form (LIGHT) */}
            <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-peach-100">
                <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.6 }}
                    className="w-full max-w-md"
                >
                    {/* Mobile Logo */}
                    <div className="lg:hidden mb-12">
                        <Link href="/" className="inline-flex items-center gap-3 group">
                            <ArrowLeft className="w-5 h-5 text-olive-400 group-hover:text-olive-600 transition-colors" />
                            <Image src="/images/sol-logo-terra.png" alt="SOL Pilates Studio" width={400} height={400} className="h-16 w-auto" />
                        </Link>
                    </div>

                    {/* Header */}
                    <div className="mb-8">
                        <div className="w-16 h-16 bg-terra-400/10 flex items-center justify-center mb-6">
                            {activeTab === 'login' ? (
                                <User className="w-8 h-8 text-terra-400" />
                            ) : (
                                <UserPlus className="w-8 h-8 text-terra-400" />
                            )}
                        </div>
                        <h2 className="text-3xl font-black text-olive-600 tracking-normal font-display">
                            {activeTab === 'login' ? 'MEMBER LOGIN' : 'CREATE ACCOUNT'}
                        </h2>
                        <p className="text-olive-300 mt-2 text-sm tracking-wider">
                            {activeTab === 'login' ? 'SIGN IN TO YOUR ACCOUNT' : 'JOIN SOL PILATES STUDIO'}
                        </p>
                    </div>

                    {/* Tab Switcher */}
                    <div className="flex mb-8 bg-peach-300/50 p-1">
                        <button
                            onClick={() => { setActiveTab('login'); setShowPassword(false) }}
                            className={`flex-1 py-3 text-xs font-bold tracking-wider transition-all ${
                                activeTab === 'login'
                                    ? 'bg-terra-400 text-peach-50'
                                    : 'text-olive-400 hover:text-olive-600'
                            }`}
                        >
                            SIGN IN
                        </button>
                        <button
                            onClick={() => { setActiveTab('signup'); setShowPassword(false) }}
                            className={`flex-1 py-3 text-xs font-bold tracking-wider transition-all ${
                                activeTab === 'signup'
                                    ? 'bg-terra-400 text-peach-50'
                                    : 'text-olive-400 hover:text-olive-600'
                            }`}
                        >
                            SIGN UP
                        </button>
                    </div>

                    {/* Forms */}
                    <AnimatePresence mode="wait">
                        {activeTab === 'login' ? (
                            <motion.div
                                key="login"
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 10 }}
                                transition={{ duration: 0.2 }}
                            >
                                <Form {...loginForm}>
                                    <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-6">
                                        <FormField
                                            control={loginForm.control}
                                            name="email"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-olive-600 text-xs font-bold tracking-wider">
                                                        EMAIL
                                                    </FormLabel>
                                                    <FormControl>
                                                        <div className="relative">
                                                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-olive-300/60" />
                                                            <Input
                                                                placeholder="you@example.com"
                                                                type="email"
                                                                {...field}
                                                                className="h-14 bg-peach-50 border-peach-400/30 text-olive-600 placeholder:text-olive-300/40 focus:border-terra-400 focus:ring-0 pl-11"
                                                            />
                                                        </div>
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={loginForm.control}
                                            name="password"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-olive-600 text-xs font-bold tracking-wider">
                                                        PASSWORD
                                                    </FormLabel>
                                                    <FormControl>
                                                        <div className="relative">
                                                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-olive-300/60" />
                                                            <Input
                                                                placeholder="Enter password"
                                                                type={showPassword ? "text" : "password"}
                                                                {...field}
                                                                className="h-14 bg-peach-50 border-peach-400/30 text-olive-600 placeholder:text-olive-300/40 focus:border-terra-400 focus:ring-0 pl-11 pr-12"
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => setShowPassword(!showPassword)}
                                                                className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-olive-300/60 hover:text-olive-600 transition-colors"
                                                            >
                                                                {showPassword ? (
                                                                    <EyeOff className="w-5 h-5" />
                                                                ) : (
                                                                    <Eye className="w-5 h-5" />
                                                                )}
                                                            </button>
                                                        </div>
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <div className="flex justify-end -mt-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setForgotEmail(loginForm.getValues("email"))
                                                    setForgotSent(false)
                                                    setForgotOpen(true)
                                                }}
                                                className="text-xs text-terra-400 hover:text-terra-300 transition-colors font-medium tracking-wide"
                                            >
                                                Forgot password?
                                            </button>
                                        </div>

                                        <Button
                                            type="submit"
                                            className="w-full h-14 bg-terra-400 text-peach-50 font-black text-sm tracking-wider hover:bg-terra-300 transition-all mt-2"
                                            disabled={isLoading}
                                        >
                                            {isLoading ? (
                                                <>
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    VERIFYING...
                                                </>
                                            ) : (
                                                "SIGN IN"
                                            )}
                                        </Button>
                                    </form>
                                </Form>

                                {/* Google Sign-In Divider & Button */}
                                <div className="relative my-6">
                                    <div className="absolute inset-0 flex items-center">
                                        <span className="w-full border-t border-peach-400/30" />
                                    </div>
                                    <div className="relative flex justify-center text-xs uppercase">
                                        <span className="bg-peach-100 px-3 text-olive-300/60 tracking-wider font-bold">OR</span>
                                    </div>
                                </div>

                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full h-14 border-peach-400/30 bg-peach-50 text-olive-600 hover:bg-peach-200 hover:text-olive-700 font-bold text-sm tracking-wider transition-all"
                                    disabled={isLoading || isGoogleLoading}
                                    onClick={onGoogleSignIn}
                                >
                                    {isGoogleLoading ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                        <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24">
                                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                                        </svg>
                                    )}
                                    CONTINUE WITH GOOGLE
                                </Button>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="signup"
                                initial={{ opacity: 0, x: 10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -10 }}
                                transition={{ duration: 0.2 }}
                            >
                                <Form {...signupForm}>
                                    <form onSubmit={signupForm.handleSubmit(onSignup)} className="space-y-5">
                                        <FormField
                                            control={signupForm.control}
                                            name="name"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-olive-600 text-xs font-bold tracking-wider">
                                                        FULL NAME
                                                    </FormLabel>
                                                    <FormControl>
                                                        <div className="relative">
                                                            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-olive-300/60" />
                                                            <Input
                                                                placeholder="Your full name"
                                                                {...field}
                                                                className="h-14 bg-peach-50 border-peach-400/30 text-olive-600 placeholder:text-olive-300/40 focus:border-terra-400 focus:ring-0 pl-11"
                                                            />
                                                        </div>
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={signupForm.control}
                                            name="email"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-olive-600 text-xs font-bold tracking-wider">
                                                        EMAIL
                                                    </FormLabel>
                                                    <FormControl>
                                                        <div className="relative">
                                                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-olive-300/60" />
                                                            <Input
                                                                placeholder="you@example.com"
                                                                type="email"
                                                                {...field}
                                                                className="h-14 bg-peach-50 border-peach-400/30 text-olive-600 placeholder:text-olive-300/40 focus:border-terra-400 focus:ring-0 pl-11"
                                                            />
                                                        </div>
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={signupForm.control}
                                            name="phone"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-olive-600 text-xs font-bold tracking-wider">
                                                        MOBILE NUMBER
                                                    </FormLabel>
                                                    <FormControl>
                                                        <div className="relative">
                                                            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-olive-300/60" />
                                                            <Input
                                                                placeholder="98765 43210"
                                                                type="tel"
                                                                inputMode="numeric"
                                                                autoComplete="tel"
                                                                {...field}
                                                                className="h-14 bg-peach-50 border-peach-400/30 text-olive-600 placeholder:text-olive-300/40 focus:border-terra-400 focus:ring-0 pl-11"
                                                            />
                                                        </div>
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={signupForm.control}
                                            name="password"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-olive-600 text-xs font-bold tracking-wider">
                                                        PASSWORD
                                                    </FormLabel>
                                                    <FormControl>
                                                        <div className="relative">
                                                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-olive-300/60" />
                                                            <Input
                                                                placeholder="At least 6 characters"
                                                                type={showPassword ? "text" : "password"}
                                                                {...field}
                                                                className="h-14 bg-peach-50 border-peach-400/30 text-olive-600 placeholder:text-olive-300/40 focus:border-terra-400 focus:ring-0 pl-11 pr-12"
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => setShowPassword(!showPassword)}
                                                                className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-olive-300/60 hover:text-olive-600 transition-colors"
                                                            >
                                                                {showPassword ? (
                                                                    <EyeOff className="w-5 h-5" />
                                                                ) : (
                                                                    <Eye className="w-5 h-5" />
                                                                )}
                                                            </button>
                                                        </div>
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={signupForm.control}
                                            name="confirmPassword"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-olive-600 text-xs font-bold tracking-wider">
                                                        CONFIRM PASSWORD
                                                    </FormLabel>
                                                    <FormControl>
                                                        <div className="relative">
                                                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-olive-300/60" />
                                                            <Input
                                                                placeholder="Repeat password"
                                                                type={showPassword ? "text" : "password"}
                                                                {...field}
                                                                className="h-14 bg-peach-50 border-peach-400/30 text-olive-600 placeholder:text-olive-300/40 focus:border-terra-400 focus:ring-0 pl-11"
                                                            />
                                                        </div>
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <Button
                                            type="submit"
                                            className="w-full h-14 bg-terra-400 text-peach-50 font-black text-sm tracking-wider hover:bg-terra-300 transition-all mt-2"
                                            disabled={isLoading}
                                        >
                                            {isLoading ? (
                                                <>
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    CREATING ACCOUNT...
                                                </>
                                            ) : (
                                                "CREATE ACCOUNT"
                                            )}
                                        </Button>
                                    </form>
                                </Form>

                                {/* Google Sign-Up Divider & Button */}
                                <div className="relative my-6">
                                    <div className="absolute inset-0 flex items-center">
                                        <span className="w-full border-t border-peach-400/30" />
                                    </div>
                                    <div className="relative flex justify-center text-xs uppercase">
                                        <span className="bg-peach-100 px-3 text-olive-300/60 tracking-wider font-bold">OR</span>
                                    </div>
                                </div>

                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full h-14 border-peach-400/30 bg-peach-50 text-olive-600 hover:bg-peach-200 hover:text-olive-700 font-bold text-sm tracking-wider transition-all"
                                    disabled={isLoading || isGoogleLoading}
                                    onClick={onGoogleSignIn}
                                >
                                    {isGoogleLoading ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                        <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24">
                                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                                        </svg>
                                    )}
                                    CONTINUE WITH GOOGLE
                                </Button>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Footer */}
                    <div className="mt-8 pt-8 border-t border-peach-400/20 flex justify-end items-center">
                        <Link href="/subscription" className="text-terra-400 text-xs tracking-wider hover:text-terra-300 transition-colors font-bold">
                            View Plans →
                        </Link>
                    </div>
                </motion.div>
            </div>

            {/* Forgot Password Modal */}
            <AnimatePresence>
                {forgotOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-olive-900/50 z-50"
                            onClick={() => setForgotOpen(false)}
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.96, y: 8 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96, y: 8 }}
                            transition={{ duration: 0.18 }}
                            className="fixed inset-0 z-50 flex items-center justify-center p-6 pointer-events-none"
                        >
                            <div className="w-full max-w-sm bg-peach-100 border border-peach-400/20 p-8 pointer-events-auto">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="font-black text-olive-700 text-lg tracking-normal">Reset Password</h3>
                                    <button onClick={() => setForgotOpen(false)} className="text-olive-300 hover:text-olive-600 transition-colors">
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>

                                {forgotSent ? (
                                    <div className="text-center py-4">
                                        <div className="w-12 h-12 bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                                            <Mail className="w-6 h-6 text-green-600" />
                                        </div>
                                        <p className="font-bold text-olive-600 mb-2">Check your inbox</p>
                                        <p className="text-sm text-olive-400">A reset link was sent to <span className="font-semibold text-olive-600">{forgotEmail}</span>. If you don&apos;t see it, check your spam folder.</p>
                                        <button
                                            onClick={() => setForgotOpen(false)}
                                            className="mt-6 w-full h-12 bg-terra-400 text-peach-50 font-black text-xs tracking-wider hover:bg-terra-300 transition-colors"
                                        >
                                            DONE
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <p className="text-sm text-olive-400 mb-6">Enter your email and we&apos;ll send you a link to reset your password.</p>
                                        <div className="space-y-4">
                                            <div>
                                                <label className="text-[10px] font-bold tracking-[0.2em] uppercase text-olive-400 block mb-2">Email</label>
                                                <div className="relative">
                                                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-olive-300/60" />
                                                    <input
                                                        type="email"
                                                        value={forgotEmail}
                                                        onChange={(e) => setForgotEmail(e.target.value)}
                                                        onKeyDown={(e) => e.key === "Enter" && handleForgotPassword()}
                                                        placeholder="you@example.com"
                                                        className="w-full h-12 pl-11 pr-4 bg-peach-50 border border-peach-400/30 text-olive-600 placeholder:text-olive-300/40 focus:border-terra-400 focus:outline-none transition-colors"
                                                    />
                                                </div>
                                            </div>
                                            <button
                                                onClick={handleForgotPassword}
                                                disabled={forgotLoading || !forgotEmail.trim()}
                                                className="w-full h-12 bg-terra-400 text-peach-50 font-black text-xs tracking-wider hover:bg-terra-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                                            >
                                                {forgotLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "SEND RESET LINK"}
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    )
}
