'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useClientAuthStore } from '@fitconnect/shared/stores/clientAuthStore';
import { Button } from '@/components/ui/button';
import { useIntroClassLead } from '@/lib/hooks/useIntroClassLead';
import { useRazorpay } from '@/lib/hooks/useRazorpay';
import { callCreatePaymentOrder, callGetPricing, callVerifyPayment } from '@fitconnect/shared/firebase/firestore';
import { getPlanById } from '@fitconnect/shared/types/subscription';
import { applyGstToRupees, formatPaise, GST_RATE_PERCENT } from '@fitconnect/shared/utils/gst';
import { toMajorUnits, trackPixel } from '@/lib/meta-pixel';

type FormState = {
    name: string;
    email: string;
    phone: string;
    goals: string;
    concerns: string;
};

const EMPTY: FormState = { name: '', email: '', phone: '', goals: '', concerns: '' };

function hasActivePlan(subscription: { status?: string; endDate?: unknown } | undefined): boolean {
    if (!subscription || subscription.status !== 'active') return false;
    if (!subscription.endDate) return true;
    const endDate = subscription.endDate instanceof Date
        ? subscription.endDate
        : new Date(subscription.endDate as string | number);
    return !Number.isNaN(endDate.getTime()) && endDate > new Date();
}

export default function IntroClassPage() {
    const router = useRouter();
    const { isAuthenticated, isLoading, initAuth, clientUser, firebaseUser, refreshSubscription } = useClientAuthStore();
    const { hasIntroClassLead, refresh: refreshIntroClassLead } = useIntroClassLead();
    const { openCheckout } = useRazorpay();
    const [form, setForm] = useState<FormState>(EMPTY);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);
    const [price, setPrice] = useState(() => getPlanById('drop_in')?.price ?? 1000);
    // Catalog price is GST-exclusive; the member is charged base + GST.
    const charge = applyGstToRupees(price);
    const hasActiveSubscription = hasActivePlan(clientUser?.subscription);

    useEffect(() => {
        const unsubscribe = initAuth();
        return () => unsubscribe();
    }, [initAuth]);

    useEffect(() => {
        if (isLoading) return;
        if (!isAuthenticated) {
            router.replace('/user/login?tab=signup&returnTo=/intro-class');
        }
    }, [isAuthenticated, isLoading, router]);

    useEffect(() => {
        if (clientUser) {
            setForm((f) => ({
                ...f,
                name: f.name || clientUser.name || '',
                email: f.email || clientUser.email || '',
            }));
        }
    }, [clientUser]);

    useEffect(() => {
        callGetPricing()
            .then((data) => {
                const dropIn = data.plans.find((plan) => plan.planId === 'drop_in');
                if (dropIn?.price) setPrice(dropIn.price);
            })
            .catch(() => {
                // Static PLAN_CATALOG price remains the fallback.
            });
    }, []);

    if (isLoading || !isAuthenticated) {
        return (
            <main className="min-h-screen bg-peach-50 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-8 h-8 border-2 border-peach-400/30 border-t-terra-400 rounded-full animate-spin" />
                    <p className="text-olive-300 text-sm tracking-wider">REDIRECTING...</p>
                </div>
            </main>
        );
    }

    const update = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm((f) => ({ ...f, [k]: e.target.value }));

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!isAuthenticated) {
            router.push('/user/login?tab=signup&returnTo=/intro-class');
            return;
        }

        if (!form.name.trim() || !form.email.trim() || !form.phone.trim()) {
            setError('Name, email, and phone are required.');
            return;
        }
        if (!/^\S+@\S+\.\S+$/.test(form.email)) {
            setError('Please enter a valid email.');
            return;
        }
        if (hasIntroClassLead === true) {
            setError('You have already booked your demo class.');
            return;
        }
        if (hasActiveSubscription) {
            setError('Demo class is only available before your first active plan.');
            return;
        }

        setSubmitting(true);
        try {
            const order = await callCreatePaymentOrder('drop_in', {
                introClassLead: {
                    ...form,
                    source: 'intro-class-payment-form',
                },
            });

            await openCheckout({
                key: order.key,
                amount: order.amount,
                currency: order.currency,
                order_id: order.orderId,
                name: 'Sol Pilates',
                description: 'Demo Class',
                prefill: {
                    email: form.email || firebaseUser?.email || undefined,
                    name: form.name || firebaseUser?.displayName || undefined,
                    contact: form.phone || undefined,
                },
                theme: { color: '#FF6A3D' },
                modal: {
                    ondismiss: () => setSubmitting(false),
                },
                handler: async (response) => {
                    try {
                        if (!response.razorpay_order_id) {
                            throw new Error('Missing Razorpay order id in checkout response');
                        }
                        await callVerifyPayment({
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                            paymentId: order.paymentId,
                        });
                        const value = toMajorUnits(order.amount);
                        trackPixel('Lead', { content_name: 'Demo Class', value, currency: order.currency });
                        trackPixel('Purchase', { content_name: 'Demo Class', value, currency: order.currency });
                        await refreshSubscription();
                        refreshIntroClassLead();
                        setDone(true);
                        router.replace('/user/schedule');
                    } catch (err) {
                        console.error(err);
                        setError('Payment verification failed. Please contact support if money was deducted.');
                    } finally {
                        setSubmitting(false);
                    }
                },
            });
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : 'Payment could not be started. Please try again.');
            setSubmitting(false);
        }
    };

    if (hasIntroClassLead === true && !done) {
        return (
            <main className="min-h-screen bg-peach-50 flex items-center justify-center p-6">
                <div className="max-w-lg text-center space-y-6">
                    <h1 className="text-4xl md:text-5xl font-black text-olive-600 uppercase tracking-normal">
                        Demo Class Booked
                    </h1>
                    <p className="text-olive-400 leading-relaxed">
                        You&apos;ve already paid for your demo class. Choose an available 30-minute Demo Class from the schedule.
                    </p>
                    <Button
                        onClick={() => router.push('/user/schedule')}
                        className="bg-terra-400 text-peach-50 hover:bg-terra-300 font-bold tracking-wide h-12 px-8 rounded-xl"
                    >
                        VIEW SCHEDULE
                    </Button>
                </div>
            </main>
        );
    }

    if (hasActiveSubscription && !done) {
        return (
            <main className="min-h-screen bg-peach-50 flex items-center justify-center p-6">
                <div className="max-w-lg text-center space-y-6">
                    <h1 className="text-4xl md:text-5xl font-black text-olive-600 uppercase tracking-normal">
                        Active Plan Found
                    </h1>
                    <p className="text-olive-400 leading-relaxed">
                        Demo class is for new clients before their first active plan. You can book regular classes from the schedule.
                    </p>
                    <Button
                        onClick={() => router.push('/user/schedule')}
                        className="bg-terra-400 text-peach-50 hover:bg-terra-300 font-bold tracking-wide h-12 px-8 rounded-xl"
                    >
                        VIEW SCHEDULE
                    </Button>
                </div>
            </main>
        );
    }

    if (done) {
        return (
            <main className="min-h-screen bg-peach-50 flex items-center justify-center p-6">
                <div className="max-w-lg text-center space-y-6">
                    <h1 className="text-4xl md:text-5xl font-black text-olive-600 uppercase tracking-normal">
                        You&apos;re booked.
                    </h1>
                    <p className="text-olive-400 leading-relaxed">
                        Payment received. Choose an available 30-minute Demo Class from the schedule.
                    </p>
                    <Button
                        onClick={() => router.push('/user/schedule')}
                        className="bg-terra-400 text-peach-50 hover:bg-terra-300 font-bold tracking-wide h-12 px-8 rounded-xl"
                    >
                        VIEW SCHEDULE
                    </Button>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-peach-50 py-16 px-6">
            <div className="max-w-xl mx-auto space-y-8">
                <header className="space-y-3">
                    <h1 className="text-4xl md:text-5xl font-black text-olive-600 uppercase tracking-normal">
                        Demo Class
                    </h1>
                    <p className="text-olive-400 leading-relaxed">
                        30 minutes, no commitment. Tell us a little about yourself, then complete the payment to book. {formatPaise(charge.basePaise)} + {GST_RATE_PERCENT}% GST = {formatPaise(charge.totalPaise)} payable.
                    </p>
                </header>

                <form onSubmit={submit} className="space-y-5">
                    <Field label="Full name *" htmlFor="name">
                        <input
                            id="name"
                            type="text"
                            value={form.name}
                            onChange={update('name')}
                            required
                            className={inputCls}
                        />
                    </Field>

                    <Field label="Email *" htmlFor="email">
                        <input
                            id="email"
                            type="email"
                            value={form.email}
                            onChange={update('email')}
                            required
                            className={inputCls}
                        />
                    </Field>

                    <Field label="Phone *" htmlFor="phone">
                        <input
                            id="phone"
                            type="tel"
                            value={form.phone}
                            onChange={update('phone')}
                            required
                            className={inputCls}
                        />
                    </Field>

                    <Field label="What are your goals?" htmlFor="goals">
                        <textarea
                            id="goals"
                            value={form.goals}
                            onChange={update('goals')}
                            rows={3}
                            className={inputCls}
                            placeholder="Strength, flexibility, recovery, weight loss..."
                        />
                    </Field>

                    <Field label="Any concerns or injuries?" htmlFor="concerns">
                        <textarea
                            id="concerns"
                            value={form.concerns}
                            onChange={update('concerns')}
                            rows={3}
                            className={inputCls}
                            placeholder="Anything we should know before your first session"
                        />
                    </Field>

                    {error && (
                        <p className="text-sm font-semibold text-red-600" role="alert">
                            {error}
                        </p>
                    )}

                    <Button
                        type="submit"
                        disabled={submitting}
                        className="w-full bg-terra-400 text-peach-50 hover:bg-terra-300 font-bold tracking-wide h-12 rounded-xl disabled:opacity-60"
                    >
                        {submitting ? 'OPENING PAYMENT…' : `PAY ${formatPaise(charge.totalPaise)} & BOOK`}
                    </Button>
                </form>
            </div>
        </main>
    );
}

const inputCls =
    'w-full rounded-xl border border-peach-400/30 bg-peach-50 px-4 py-3 text-olive-600 placeholder:text-olive-300 focus:border-terra-400 focus:outline-none focus:ring-2 focus:ring-terra-400/30';

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
    return (
        <label htmlFor={htmlFor} className="block space-y-2">
            <span className="block text-xs font-bold uppercase tracking-wider text-olive-400">{label}</span>
            {children}
        </label>
    );
}
