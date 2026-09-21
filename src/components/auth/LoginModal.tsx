"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { signInWithEmailAndPassword } from "firebase/auth"
import { auth } from "@fitconnect/shared/firebase/config"
import { useClientAuthStore } from "@fitconnect/shared/stores/clientAuthStore"
import { toast } from "sonner"
import { trackPixel } from "@/lib/meta-pixel"

const loginSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(1, "Password is required"),
})

interface LoginModalProps {
    trigger?: React.ReactNode;
    defaultOpen?: boolean;
    isOpenOverride?: boolean;
    onCloseOverride?: () => void;
}

export function LoginModal({ trigger, defaultOpen = false, isOpenOverride, onCloseOverride }: LoginModalProps) {
    const [internalOpen, setInternalOpen] = React.useState(defaultOpen)

    const isModalOpen = isOpenOverride !== undefined ? isOpenOverride : internalOpen;
    const setModalOpen = (open: boolean) => {
        if (onCloseOverride && !open) {
            onCloseOverride();
        } else {
            setInternalOpen(open);
        }
    }
    const [isLoading, setIsLoading] = React.useState(false)
    const [isGoogleLoading, setIsGoogleLoading] = React.useState(false)
    const googleSignIn = useClientAuthStore((s) => s.googleSignIn)

    const form = useForm<z.infer<typeof loginSchema>>({
        resolver: zodResolver(loginSchema),
        defaultValues: {
            email: "",
            password: "",
        },
    })

    async function onSubmit(values: z.infer<typeof loginSchema>) {
        try {
            setIsLoading(true)
            await signInWithEmailAndPassword(auth, values.email, values.password)
            toast.success("Welcome back!")
            setModalOpen(false)
        } catch {
            toast.error("Invalid email or password")
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <Dialog open={isModalOpen} onOpenChange={setModalOpen}>
            {(trigger || isOpenOverride === undefined) && (
                <DialogTrigger asChild>
                    {trigger || <Button variant="ghost">Log in</Button>}
                </DialogTrigger>
            )}
            <DialogContent className="sm:max-w-[425px] bg-warmDark-800 border-peach-400/10">
                <DialogHeader>
                    <DialogTitle>Welcome back</DialogTitle>
                    <DialogDescription>
                        Enter your credentials to access your account.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="email"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Email</FormLabel>
                                    <FormControl>
                                        <Input placeholder="john@example.com" type="email" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="password"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Password</FormLabel>
                                    <FormControl>
                                        <Input placeholder="******" type="password" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <Button type="submit" className="w-full bg-terra-400 text-peach-50 hover:bg-terra-300 font-bold" disabled={isLoading || isGoogleLoading}>
                            {isLoading && <svg className="mr-2 h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                            Log In
                        </Button>
                    </form>
                </Form>

                <div className="relative my-4">
                    <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-peach-400/20" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-warmDark-800 px-2 text-peach-400/60">or</span>
                    </div>
                </div>

                <Button
                    type="button"
                    variant="outline"
                    className="w-full border-peach-400/20 text-peach-100 hover:bg-warmDark-700 hover:text-peach-50 font-medium"
                    disabled={isLoading || isGoogleLoading}
                    onClick={async () => {
                        setIsGoogleLoading(true)
                        const result = await googleSignIn()
                        setIsGoogleLoading(false)
                        if (result.success) {
                            if (result.isNewUser) trackPixel("CompleteRegistration", { content_name: "google" })
                            toast.success("Welcome back!")
                            setModalOpen(false)
                        } else {
                            toast.error(result.error || "Google sign-in failed")
                        }
                    }}
                >
                    {isGoogleLoading ? (
                        <svg className="mr-2 h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    ) : (
                        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                        </svg>
                    )}
                    Continue with Google
                </Button>
            </DialogContent>
        </Dialog>
    )
}
