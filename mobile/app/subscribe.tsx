import { Fragment, useState, useMemo, useCallback, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
// react-native-razorpay is a native module that does not exist in Expo Go.
// Load it lazily inside the payment handler so the rest of the screen still
// runs in Expo Go; the live checkout requires a native dev build.
type RazorpayCheckoutModule = {
    open: (options: Record<string, unknown>) => Promise<{
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
    }>;
};
function loadRazorpay(): RazorpayCheckoutModule {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-razorpay');
    const checkout = (mod?.default ?? mod) as RazorpayCheckoutModule | undefined;
    if (!checkout || typeof checkout.open !== 'function') {
        throw new Error('Razorpay checkout requires a native dev build and is not available in Expo Go.');
    }
    return checkout;
}
import { PLAN_CATALOG, findPlan, purchasablePlans } from '@fitconnect/shared/types/subscription';
import type { PlanDefinition, PlanCategory } from '@fitconnect/shared/types/subscription';
import {
    callAbandonRazorpaySubscription,
    callCreatePaymentOrder,
    callCreateRazorpaySubscription,
    callVerifyPayment,
    callVerifyRazorpaySubscription,
    callUpdateRazorpaySubscription,
    callCancelSubscription,
    callGetPricing,
} from '@fitconnect/shared/firebase/firestore';
import { useClientAuthStore } from '@fitconnect/shared/stores/clientAuthStore';
import { useIntroClassLead } from '../hooks/useIntroClassLead';
import { Colors, Spacing, FontSize, BorderRadius, Shadows, Alpha, FontFamily } from '../constants/theme';
import { applyGstToRupees, formatPaise, GST_RATE_PERCENT, type GstBreakdown } from '@fitconnect/shared/utils/gst';

const ZERO_CHARGE: GstBreakdown = { basePaise: 0, gstPaise: 0, totalPaise: 0 };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = 'plan' | 'checkout' | 'success';

interface PaymentResult {
    planName: string;
    credits: number | null;
    endDate: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getPaymentErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (err && typeof err === 'object') {
        const data = err as {
            description?: string;
            code?: string | number;
            error?: { description?: string; reason?: string };
        };
        return data.error?.description || data.error?.reason || data.description || `Payment failed${data.code ? ` (${data.code})` : ''}`;
    }
    return 'Something went wrong. Please try again.';
}

// ---------------------------------------------------------------------------
// Step Indicator
// ---------------------------------------------------------------------------

function StepIndicator({ current }: { current: Step }) {
    const steps: Step[] = ['plan', 'checkout'];
    const currentIdx = current === 'success' ? 2 : steps.indexOf(current);

    return (
        <View style={stepStyles.container}>
            {steps.map((step, i) => {
                const isCompleted = i < currentIdx;
                const isCurrent = i === currentIdx;

                return (
                    <View key={step} style={stepStyles.row}>
                        {i > 0 && (
                            <View
                                style={[
                                    stepStyles.line,
                                    isCompleted && stepStyles.lineCompleted,
                                ]}
                            />
                        )}
                        <View
                            style={[
                                stepStyles.circle,
                                isCurrent && stepStyles.circleCurrent,
                                isCompleted && stepStyles.circleCompleted,
                            ]}
                        >
                            {isCompleted ? (
                                <Feather name="check" size={14} color={Colors.terra[400]} />
                            ) : (
                                <Text
                                    style={[
                                        stepStyles.circleText,
                                        isCurrent && stepStyles.circleTextCurrent,
                                    ]}
                                >
                                    {i + 1}
                                </Text>
                            )}
                        </View>
                    </View>
                );
            })}
        </View>
    );
}

const stepStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: Spacing.lg,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    line: {
        width: 48,
        height: 2,
        backgroundColor: Alpha.peach400_20,
        marginHorizontal: Spacing.sm,
    },
    lineCompleted: {
        backgroundColor: Colors.terra[400],
    },
    circle: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: Alpha.peach200_50,
        justifyContent: 'center',
        alignItems: 'center',
    },
    circleCurrent: {
        backgroundColor: Colors.terra[400],
    },
    circleCompleted: {
        backgroundColor: Alpha.terra400_20,
    },
    circleText: {
        fontSize: FontSize.sm,
        fontWeight: '700',
        color: Colors.olive[300],
    },
    circleTextCurrent: {
        color: Colors.white,
    },
});

// ---------------------------------------------------------------------------
// Plan Card
// ---------------------------------------------------------------------------

function PlanCard({
    plan,
    selected,
    onSelect,
    charge,
}: {
    plan: PlanDefinition;
    selected: boolean;
    onSelect: () => void;
    charge: GstBreakdown;
}) {
    return (
        <TouchableOpacity
            style={[
                planCardStyles.card,
                selected && planCardStyles.cardSelected,
            ]}
            onPress={onSelect}
            activeOpacity={0.7}
        >
            {/* Selected check */}
            {selected && (
                <View style={planCardStyles.checkIcon}>
                    <Feather name="check-circle" size={22} color={Colors.terra[400]} />
                </View>
            )}

            {/* Popular badge */}
            {plan.recommended && (
                <View style={planCardStyles.popularBadge}>
                    <Feather
                        name="star"
                        size={12}
                        color={Colors.terra[400]}
                        style={{ marginRight: 4 }}
                    />
                    <Text style={planCardStyles.popularText}>Popular</Text>
                </View>
            )}

            <Text style={planCardStyles.planName}>{plan.name}</Text>

            <View style={planCardStyles.priceRow}>
                <Text style={planCardStyles.price}>{formatPaise(charge.basePaise)}</Text>
                <Text style={planCardStyles.priceSuffix}>
                    {plan.credits === 1
                        ? '/session'
                        : plan.category === 'membership'
                            ? plan.durationDays === 30 ? '/month' : ''
                            : '/pack'}
                </Text>
            </View>
            {charge.gstPaise > 0 && (
                <Text style={planCardStyles.gstNote}>
                    + {GST_RATE_PERCENT}% GST · {formatPaise(charge.totalPaise)} total
                </Text>
            )}

            <Text style={planCardStyles.credits}>
                {plan.credits === null
                    ? 'Unlimited classes'
                    : `${plan.credits} class${plan.credits === 1 ? '' : 'es'}`}
            </Text>
            <Text style={planCardStyles.duration}>
                {plan.durationDays} day validity
            </Text>
        </TouchableOpacity>
    );
}

const planCardStyles = StyleSheet.create({
    card: {
        backgroundColor: Colors.peach[50],
        borderWidth: 1,
        borderColor: Alpha.peach400_20,
        borderRadius: BorderRadius['2xl'],
        padding: Spacing.lg - 4,
        marginBottom: Spacing.md,
        position: 'relative',
    },
    cardSelected: {
        borderColor: Colors.terra[400],
        borderWidth: 2,
    },
    checkIcon: {
        position: 'absolute',
        top: Spacing.md,
        right: Spacing.md,
    },
    popularBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: Colors.terra[400],
        backgroundColor: Alpha.terra400_10,
        borderRadius: BorderRadius.full,
        paddingHorizontal: Spacing.sm + 2,
        paddingVertical: Spacing.xs,
        marginBottom: Spacing.sm,
    },
    popularText: {
        fontSize: FontSize.xs,
        fontWeight: '700',
        color: Colors.terra[400],
    },
    planName: {
        fontSize: FontSize.lg,
        fontWeight: '700',
        color: Colors.olive[600],
        marginBottom: Spacing.xs,
    },
    priceRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        marginBottom: Spacing.sm,
    },
    price: {
        fontSize: FontSize['3xl'],
        fontWeight: '700',
        color: Colors.olive[600],
        fontVariant: ['tabular-nums'],
    },
    gstNote: {
        fontFamily: 'PlusJakartaSans_400Regular',
        fontSize: FontSize.xs,
        color: Colors.secondaryText,
        marginTop: 2,
    },
    priceSuffix: {
        fontSize: FontSize.sm,
        color: Colors.olive[300],
        marginLeft: 4,
    },
    credits: {
        fontSize: FontSize.sm,
        color: Colors.olive[300],
    },
    duration: {
        fontSize: FontSize.sm,
        color: Colors.olive[300],
        marginTop: 2,
    },
});

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function SubscribeScreen() {
    const router = useRouter();
    const { clientUser, firebaseUser, refreshSubscription } = useClientAuthStore();
    const { hasIntroClassLead } = useIntroClassLead();

    // Cancel state
    const [isCancelling, setIsCancelling] = useState(false);

    // Flow state
    const [step, setStep] = useState<Step>('plan');
    const [activeTab, setActiveTab] = useState<PlanCategory>('membership');
    const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
    const [chargeOverrides, setChargeOverrides] = useState<Record<string, GstBreakdown>>({});
    // Defaults + admin edits from the server; the static catalog is the offline fallback.
    const [catalog, setCatalog] = useState<PlanDefinition[]>(PLAN_CATALOG);

    // Processing state
    const [paymentState, setPaymentState] = useState<
        'idle' | 'processing' | 'success'
    >('idle');
    const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null);

    // Filtered plans
    const filteredPlans = useMemo(
        () => purchasablePlans(catalog).filter((p) => p.category === activeTab),
        [catalog, activeTab],
    );

    const selectedPlan = selectedPlanId ? findPlan(catalog, selectedPlanId) : null;
    // Membership prices arrive from the API GST-INCLUSIVE, so re-applying GST to
    // them would double-count. The server sends the authoritative split.
    const chargeFor = useCallback(
        (plan: PlanDefinition): GstBreakdown =>
            chargeOverrides[plan.id] ?? applyGstToRupees(plan.price),
        [chargeOverrides],
    );
    const selectedCharge = selectedPlan ? chargeFor(selectedPlan) : ZERO_CHARGE;
    const hasActiveSubscription = clientUser?.subscription?.status === 'active' && (
        !clientUser.subscription.endDate ||
        new Date(clientUser.subscription.endDate).getTime() > Date.now()
    );
    const currentPlan = clientUser?.subscription?.planId ? findPlan(catalog, clientUser.subscription.planId) : null;
    const activePlanIsMembership = clientUser?.subscription?.planCategory === 'membership' || currentPlan?.category === 'membership';
    const hasActiveMembership = hasActiveSubscription && (clientUser?.subscription?.planCategory === 'membership' || currentPlan?.category === 'membership');
    const selectedCurrentPlan = hasActiveMembership && selectedPlan?.id === clientUser?.subscription?.planId;
    const renewalCanceled = clientUser?.subscription?.cancelAtPeriodEnd === true;

    const handleCancelSubscription = useCallback(() => {
        Alert.alert(
            activePlanIsMembership ? 'Cancel renewal?' : 'Cancel your plan?',
            activePlanIsMembership
                ? "Your plan stays active until the current period ends. You won't be charged again."
                : 'Class packs do not auto-renew. Credits remain usable until the plan expires.',
            [
                { text: 'Keep Plan', style: 'cancel' },
                {
                    text: 'Yes, Cancel',
                    style: 'destructive',
                    onPress: async () => {
                        setIsCancelling(true);
                        try {
                            const result = await callCancelSubscription();
                            await refreshSubscription();
                            Alert.alert(
                                result.mode === 'immediate' ? 'Plan cancelled' : 'Renewal cancelled',
                                result.mode === 'immediate'
                                    ? 'Your plan has been cancelled.'
                                    : 'Your membership stays active until the current period ends.',
                            );
                        } catch {
                            Alert.alert('Error', 'Failed to cancel. Please try again.');
                        } finally {
                            setIsCancelling(false);
                        }
                    },
                },
            ],
        );
    }, [activePlanIsMembership, refreshSubscription]);

    useEffect(() => {
        let mounted = true;

        callGetPricing()
            .then((data) => {
                if (!mounted) return;
                const overrides: Record<string, GstBreakdown> = {};
                for (const plan of data.plans) {
                    if (plan.charge) overrides[plan.planId] = plan.charge;
                }
                setChargeOverrides(overrides);
                if (data.catalog?.length) setCatalog(data.catalog);
            })
            .catch(() => {
                // Static PLAN_CATALOG prices remain the offline fallback.
            });

        return () => {
            mounted = false;
        };
    }, []);

    // Navigate to checkout
    const handleContinue = useCallback(() => {
        if (!selectedPlan) {
            Alert.alert('Select a Plan', 'Please choose a plan to continue.');
            return;
        }
        if (selectedPlan.id === 'drop_in' && hasActiveSubscription) {
            Alert.alert(
                'Active Membership',
                'Demo class is only available before your first active plan.',
            );
            return;
        }
        if (selectedCurrentPlan) {
            Alert.alert('Current Plan', 'You are already on this membership.');
            return;
        }
        if (selectedPlan.id === 'drop_in') {
            router.push('/intro-class');
            return;
        }
        if (selectedPlan.category === 'class_pack' && hasActiveMembership) {
            Alert.alert(
                'Active Membership',
                'Starter packs are only available before an active membership.',
            );
            return;
        }
        if (hasActiveMembership && renewalCanceled) {
            Alert.alert(
                'Renewal Canceled',
                'You can choose a new membership after the current paid period ends.',
            );
            return;
        }
        setStep('checkout');
    }, [selectedPlan, hasActiveSubscription, selectedCurrentPlan, hasActiveMembership, renewalCanceled, router]);

    // Process payment
    const handlePay = useCallback(async () => {
        if (!selectedPlan) return;
        setPaymentState('processing');
        try {
            if (selectedPlan.category === 'membership' && hasActiveMembership) {
                const result = await callUpdateRazorpaySubscription(selectedPlan.id);
                await refreshSubscription();

                if (result.mode === 'scheduled') {
                    setPaymentState('idle');
                    setStep('plan');
                    Alert.alert(
                        'Plan Change Scheduled',
                        result.effectiveAt
                            ? `Your ${result.planName} membership starts on ${formatDate(result.effectiveAt)}.`
                            : `Your ${result.planName} membership starts at the end of this billing cycle.`,
                    );
                    return;
                }

                setPaymentResult({
                    planName: result.planName,
                    credits: selectedPlan.credits,
                    endDate: result.endDate,
                });
                setPaymentState('success');
                setStep('success');
                return;
            }

            const RazorpayCheckout = loadRazorpay();

            const result = selectedPlan.category === 'membership'
                ? await (async () => {
                    const subscription = await callCreateRazorpaySubscription(selectedPlan.id);
                    let response: {
                        razorpay_subscription_id?: string;
                        razorpay_payment_id: string;
                        razorpay_signature: string;
                    };

                    try {
                        response = await RazorpayCheckout.open({
                            key: subscription.key,
                            amount: subscription.amount,
                            currency: subscription.currency,
                            subscription_id: subscription.subscriptionId,
                            name: 'Sol Pilates',
                            description: selectedPlan.name,
                            prefill: {
                                email: firebaseUser?.email ?? clientUser?.email ?? undefined,
                                name: firebaseUser?.displayName ?? clientUser?.name ?? undefined,
                            },
                            theme: { color: Colors.terra[400] },
                        } as unknown as Parameters<typeof RazorpayCheckout.open>[0]) as typeof response;
                    } catch (error) {
                        await callAbandonRazorpaySubscription({
                            subscriptionId: subscription.subscriptionId,
                            paymentId: subscription.paymentId,
                        }).catch(() => undefined);
                        throw error;
                    }

                    if (!response.razorpay_subscription_id) {
                        await callAbandonRazorpaySubscription({
                            subscriptionId: subscription.subscriptionId,
                            paymentId: subscription.paymentId,
                        }).catch(() => undefined);
                        throw new Error('Missing Razorpay subscription id in checkout response');
                    }

                    return callVerifyRazorpaySubscription({
                        razorpay_subscription_id: response.razorpay_subscription_id,
                        razorpay_payment_id: response.razorpay_payment_id,
                        razorpay_signature: response.razorpay_signature,
                        paymentId: subscription.paymentId,
                    });
                })()
                : await (async () => {
                    const order = await callCreatePaymentOrder(selectedPlan.id);
                    const response = await RazorpayCheckout.open({
                        key: order.key,
                        amount: order.amount,
                        currency: order.currency,
                        order_id: order.orderId,
                        name: 'Sol Pilates',
                        description: selectedPlan.name,
                        prefill: {
                            email: firebaseUser?.email ?? clientUser?.email ?? undefined,
                            name: firebaseUser?.displayName ?? clientUser?.name ?? undefined,
                        },
                        theme: { color: Colors.terra[400] },
                    });

                    return callVerifyPayment({
                        razorpay_order_id: response.razorpay_order_id,
                        razorpay_payment_id: response.razorpay_payment_id,
                        razorpay_signature: response.razorpay_signature,
                        paymentId: order.paymentId,
                    });
                })();

            setPaymentResult({
                planName: result.planName,
                credits: result.credits,
                endDate: result.endDate,
            });
            setPaymentState('success');
            setStep('success');
            await refreshSubscription();
        } catch (err: unknown) {
            setPaymentState('idle');
            const message = getPaymentErrorMessage(err);
            Alert.alert('Payment Error', message);
        }
    }, [selectedPlan, hasActiveMembership, firebaseUser, clientUser, refreshSubscription]);

    // Back handler
    const handleBack = useCallback(() => {
        if (step === 'checkout') {
            setStep('plan');
            setPaymentState('idle');
        } else {
            router.back();
        }
    }, [step, router]);

    return (
        <SafeAreaView style={styles.safeArea} edges={['top']}>
            <ScrollView
                style={styles.container}
                contentContainerStyle={styles.contentContainer}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                {/* Header */}
                {step !== 'success' && (
                    <View style={styles.header}>
                        <TouchableOpacity
                            style={styles.backButton}
                            onPress={handleBack}
                            activeOpacity={0.7}
                        >
                            <Feather
                                name="arrow-left"
                                size={22}
                                color={Colors.olive[600]}
                            />
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>
                            {step === 'plan' ? 'Choose Your Plan' : 'Checkout'}
                        </Text>
                    </View>
                )}

                {/* Step indicator */}
                {step !== 'success' && <StepIndicator current={step} />}

                {/* ─── PLAN SELECTION STEP ─────────────────── */}
                {step === 'plan' && (
                    <View>
                        {/* Active subscription management */}
                        {hasActiveSubscription && clientUser?.subscription.planId && (
                            <View style={styles.mgmtCard}>
                                <View style={styles.mgmtHeader}>
                                    <View style={styles.mgmtIcon}>
                                        <Feather name="credit-card" size={18} color={Colors.terra[400]} />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.mgmtPlanName}>
                                            {clientUser.subscription.planId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                                        </Text>
                                        <Text style={styles.mgmtSubtitle}>
                                            {renewalCanceled ? 'Renewal canceled' : 'Active membership'}
                                        </Text>
                                    </View>
                                    <View style={[styles.activeBadge, renewalCanceled && styles.renewalCanceledBadge]}>
                                        <Text style={[styles.activeBadgeText, renewalCanceled && styles.renewalCanceledBadgeText]}>
                                            {renewalCanceled ? 'RENEWAL CANCELED' : 'ACTIVE'}
                                        </Text>
                                    </View>
                                </View>
                                {activePlanIsMembership && !renewalCanceled && (
                                    <TouchableOpacity
                                        style={styles.cancelBtn}
                                        onPress={handleCancelSubscription}
                                        disabled={isCancelling}
                                        activeOpacity={0.85}
                                    >
                                        <Feather name="x-circle" size={14} color={Colors.terra[400]} />
                                        <Text style={styles.cancelBtnText}>
                                            {isCancelling ? 'CANCELLING...' : 'CANCEL RENEWAL'}
                                        </Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        )}

                        {/* Tab toggle */}
                        <View style={styles.tabToggleContainer}>
                            <TouchableOpacity
                                style={[
                                    styles.tabButton,
                                    activeTab === 'membership' && styles.tabButtonActive,
                                ]}
                                onPress={() => {
                                    setActiveTab('membership');
                                    setSelectedPlanId(null);
                                }}
                                activeOpacity={0.7}
                            >
                                <Text
                                    style={[
                                        styles.tabButtonText,
                                        activeTab === 'membership' &&
                                            styles.tabButtonTextActive,
                                    ]}
                                >
                                    MEMBERSHIPS
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[
                                    styles.tabButton,
                                    activeTab === 'class_pack' && styles.tabButtonActive,
                                ]}
                                onPress={() => {
                                    setActiveTab('class_pack');
                                    setSelectedPlanId(null);
                                }}
                                activeOpacity={0.7}
                            >
                                <Text
                                    style={[
                                        styles.tabButtonText,
                                        activeTab === 'class_pack' &&
                                            styles.tabButtonTextActive,
                                    ]}
                                >
                                    CLASS PACKS
                                </Text>
                            </TouchableOpacity>
                        </View>

                        {/* Plan cards */}
                        {filteredPlans.map((plan) => (
                            <Fragment key={plan.id}>
                                <PlanCard
                                    plan={plan}
                                    selected={selectedPlanId === plan.id}
                                    onSelect={() => setSelectedPlanId(plan.id)}
                                    charge={chargeFor(plan)}
                                />
                                {selectedPlanId === plan.id && (
                                    <Fragment>
                                    <View style={styles.featuresCard}>
                                        <Text style={styles.featuresTitle}>WHAT YOU GET</Text>
                                        {plan.features.map((feature, i) => (
                                            <View key={i} style={styles.featureRow}>
                                                <Feather
                                                    name="check-circle"
                                                    size={16}
                                                    color={Colors.terra[400]}
                                                    style={{ marginRight: Spacing.sm }}
                                                />
                                                <Text style={styles.featureText}>{feature}</Text>
                                            </View>
                                        ))}
                                    </View>
                        {/* Continue button */}
                        <TouchableOpacity
                            style={[
                                styles.primaryButton,
                                styles.planContinueButton,
                                (!selectedPlan ||
                                    selectedCurrentPlan ||
                                    (hasActiveMembership && renewalCanceled) ||
                                    (selectedPlan?.id === 'drop_in' && hasActiveSubscription) ||
                                    (selectedPlan?.category === 'class_pack' && hasActiveMembership) ||
                                    (selectedPlan?.id === 'drop_in' &&
                                        hasIntroClassLead === true)) &&
                                    styles.buttonDisabled,
                            ]}
                            onPress={handleContinue}
                            disabled={
                                !selectedPlan ||
                                selectedCurrentPlan ||
                                (hasActiveMembership && renewalCanceled) ||
                                (selectedPlan?.id === 'drop_in' && hasActiveSubscription) ||
                                (selectedPlan?.category === 'class_pack' && hasActiveMembership) ||
                                (selectedPlan?.id === 'drop_in' &&
                                    hasIntroClassLead === true)
                            }
                            activeOpacity={0.7}
                        >
                            <Text style={styles.primaryButtonText}>
                                {selectedCurrentPlan
                                    ? 'CURRENT PLAN'
                                    : hasActiveMembership && renewalCanceled
                                        ? 'RENEWAL CANCELED'
                                    : selectedPlan?.id === 'drop_in'
                                    ? hasIntroClassLead === true
                                        ? 'DEMO CLASS BOOKED'
                                        : 'BOOK DEMO CLASS'
                                    : selectedPlan?.category === 'class_pack' && hasActiveMembership
                                        ? 'ACTIVE MEMBERSHIP'
                                    : hasActiveMembership
                                        ? 'UPDATE MEMBERSHIP'
                                        : 'CONTINUE'}
                            </Text>
                        </TouchableOpacity>
                                    </Fragment>
                                )}
                            </Fragment>
                        ))}
                    </View>
                )}

                {/* ─── CHECKOUT STEP ──────────────────────── */}
                {step === 'checkout' && selectedPlan && (
                    <View>
                        {/* Order summary */}
                        <View style={styles.orderSummary}>
                            <Text style={styles.orderPlanName}>{selectedPlan.name}</Text>
                            <Text style={styles.orderLabel}>
                                {selectedPlan.category === 'membership' ? 'Recurring membership' : 'One-time payment'}
                            </Text>
                            <Text style={styles.orderAmount}>{formatPaise(selectedCharge.totalPaise)}</Text>
                            <Text style={styles.orderGstLine}>
                                {formatPaise(selectedCharge.basePaise)} + {formatPaise(selectedCharge.gstPaise)} GST @ {GST_RATE_PERCENT}%
                            </Text>
                        </View>

                        {/* Razorpay checkout */}
                        <View style={styles.formSection}>
                            <View style={styles.gatewayRow}>
                                <View style={styles.gatewayIcon}>
                                    <Feather name="credit-card" size={20} color={Colors.terra[400]} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.gatewayTitle}>Razorpay Checkout</Text>
                                    <Text style={styles.gatewaySubtitle}>
                                        Pay securely with UPI, cards, wallets, or net banking.
                                    </Text>
                                </View>
                            </View>
                        </View>

                        {/* Pay button */}
                        <TouchableOpacity
                            style={[
                                styles.primaryButton,
                                paymentState !== 'idle' && styles.buttonDisabled,
                            ]}
                            onPress={handlePay}
                            disabled={paymentState !== 'idle'}
                            activeOpacity={0.7}
                        >
                            {paymentState === 'processing' ? (
                                <View style={styles.payingRow}>
                                    <ActivityIndicator
                                        size="small"
                                        color={Colors.white}
                                        style={{ marginRight: Spacing.sm }}
                                    />
                                    <Text style={styles.primaryButtonText}>PROCESSING...</Text>
                                </View>
                            ) : paymentState === 'success' ? (
                                <View style={styles.payingRow}>
                                    <Feather
                                        name="check"
                                        size={18}
                                        color={Colors.white}
                                        style={{ marginRight: Spacing.sm }}
                                    />
                                    <Text style={styles.primaryButtonText}>
                                        PAYMENT SUCCESSFUL
                                    </Text>
                                </View>
                            ) : (
                                <Text style={styles.primaryButtonText}>
                                    PAY {formatPaise(selectedCharge.totalPaise)}
                                </Text>
                            )}
                        </TouchableOpacity>

                        {/* Security footer */}
                        <View style={styles.securityFooter}>
                            <Feather
                                name="lock"
                                size={14}
                                color={Alpha.olive300_50}
                                style={{ marginRight: 6 }}
                            />
                            <Text style={styles.securityText}>
                                Secured with 256-bit encryption
                            </Text>
                        </View>
                    </View>
                )}

                {/* ─── SUCCESS STEP ───────────────────────── */}
                {step === 'success' && paymentResult && (
                    <View style={styles.successContainer}>
                        {/* Large check icon */}
                        <View style={styles.successIconWrap}>
                            <Feather
                                name="check-circle"
                                size={64}
                                color={Colors.terra[400]}
                            />
                        </View>

                        <Text style={styles.successTitle}>You&apos;re All Set!</Text>

                        {/* Plan summary card */}
                        <View style={styles.successSummary}>
                            <View style={styles.summaryRow}>
                                <Text style={styles.summaryLabel}>Plan</Text>
                                <Text style={styles.summaryValue}>
                                    {paymentResult.planName}
                                </Text>
                            </View>
                            <View style={styles.summaryDivider} />
                            <View style={styles.summaryRow}>
                                <Text style={styles.summaryLabel}>Credits</Text>
                                <Text style={styles.summaryValue}>
                                    {paymentResult.credits === null
                                        ? 'Unlimited'
                                        : paymentResult.credits}
                                </Text>
                            </View>
                            <View style={styles.summaryDivider} />
                            <View style={styles.summaryRow}>
                                <Text style={styles.summaryLabel}>Valid Until</Text>
                                <Text style={styles.summaryValue}>
                                    {formatDate(paymentResult.endDate)}
                                </Text>
                            </View>
                        </View>

                        {/* Book a Class button */}
                        <TouchableOpacity
                            style={styles.primaryButton}
                            onPress={() => router.replace('/(tabs)/schedule')}
                            activeOpacity={0.7}
                        >
                            <View style={styles.payingRow}>
                                <Feather
                                    name="calendar"
                                    size={18}
                                    color={Colors.white}
                                    style={{ marginRight: Spacing.sm }}
                                />
                                <Text style={styles.primaryButtonText}>BOOK A CLASS</Text>
                            </View>
                        </TouchableOpacity>

                        {/* Go to Dashboard button */}
                        <TouchableOpacity
                            style={styles.outlineButton}
                            onPress={() => router.replace('/(tabs)')}
                            activeOpacity={0.7}
                        >
                            <Text style={styles.outlineButtonText}>GO TO DASHBOARD</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: Colors.background,
    },
    container: {
        flex: 1,
        backgroundColor: Colors.background,
    },
    contentContainer: {
        paddingHorizontal: Spacing.md,
        paddingTop: Spacing.md,
        paddingBottom: 100,
    },

    // Header
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: Spacing.lg,
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: Colors.peach[50],
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: Spacing.sm + 4,
    },
    headerTitle: {
        fontSize: FontSize['2xl'],
        fontWeight: '800',
        color: Colors.olive[600],
    },

    // Active subscription management card
    mgmtCard: {
        backgroundColor: Colors.peach[50],
        borderRadius: BorderRadius['2xl'],
        borderWidth: 1,
        borderColor: `${Colors.peach[400]}26`,
        padding: Spacing.md,
        gap: Spacing.sm,
        marginBottom: Spacing.md,
    },
    mgmtHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    mgmtIcon: {
        width: 36,
        height: 36,
        borderRadius: 10,
        backgroundColor: Alpha.terra400_10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    mgmtPlanName: {
        fontFamily: FontFamily.sansExtra,
        fontSize: FontSize.sm,
        color: Colors.olive[600],
    },
    mgmtSubtitle: {
        fontFamily: FontFamily.sans,
        fontSize: FontSize.xs,
        color: Colors.olive[300],
        marginTop: 1,
    },
    activeBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 99,
        backgroundColor: 'rgba(34,197,94,0.1)',
        borderWidth: 1,
        borderColor: 'rgba(34,197,94,0.2)',
    },
    activeBadgeText: {
        fontFamily: FontFamily.sansExtra,
        fontSize: 9,
        color: 'rgb(21,128,61)',
        letterSpacing: 0.8,
    },
    renewalCanceledBadge: {
        backgroundColor: Alpha.peach300_40,
        borderColor: Colors.warning,
    },
    renewalCanceledBadgeText: {
        color: Colors.warning,
    },
    cancelBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        borderWidth: 2,
        borderColor: Colors.terra[400],
        backgroundColor: `${Colors.terra[400]}1A`,
        borderRadius: BorderRadius.xl,
        paddingVertical: 10,
    },
    cancelBtnText: {
        fontFamily: FontFamily.sansExtra,
        fontSize: FontSize.xs,
        color: Colors.terra[400],
        letterSpacing: 0.8,
    },

    // Tab toggle
    tabToggleContainer: {
        flexDirection: 'row',
        backgroundColor: Alpha.peach200_50,
        borderRadius: BorderRadius.full,
        padding: 4,
        marginBottom: Spacing.lg,
    },
    tabButton: {
        flex: 1,
        paddingVertical: Spacing.sm + 2,
        borderRadius: BorderRadius.full,
        alignItems: 'center',
    },
    tabButtonActive: {
        backgroundColor: Colors.terra[400],
        ...Shadows.md,
    },
    tabButtonText: {
        fontSize: FontSize.xs,
        fontWeight: '700',
        color: Colors.olive[400],
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    tabButtonTextActive: {
        color: Colors.white,
    },

    // Features
    featuresCard: {
        backgroundColor: Alpha.peach200_30,
        borderWidth: 1,
        borderColor: Alpha.peach400_10,
        borderRadius: BorderRadius['2xl'],
        padding: Spacing.lg - 4,
        marginBottom: Spacing.lg,
    },
    featuresTitle: {
        fontSize: FontSize.xs,
        fontWeight: '700',
        color: Colors.olive[300],
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: Spacing.sm + 4,
    },
    featureRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: Spacing.sm,
    },
    featureText: {
        fontSize: FontSize.sm,
        color: Colors.olive[400],
        flex: 1,
    },

    // Buttons
    planContinueButton: {
        marginBottom: Spacing.lg,
    },
    primaryButton: {
        backgroundColor: Colors.terra[400],
        borderRadius: BorderRadius.xl,
        height: 56,
        justifyContent: 'center',
        alignItems: 'center',
    },
    primaryButtonText: {
        color: Colors.white,
        fontSize: FontSize.sm,
        fontWeight: '700',
        letterSpacing: 1.5,
    },
    buttonDisabled: {
        opacity: 0.5,
    },
    outlineButton: {
        borderWidth: 1,
        borderColor: Alpha.peach400_20,
        borderRadius: BorderRadius.xl,
        height: 56,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: Spacing.sm + 4,
    },
    outlineButtonText: {
        color: Colors.olive[600],
        fontSize: FontSize.sm,
        fontWeight: '700',
        letterSpacing: 1.5,
    },
    payingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },

    // Order summary
    orderSummary: {
        backgroundColor: Alpha.peach200_40,
        borderRadius: BorderRadius['2xl'],
        padding: Spacing.lg - 4,
        marginBottom: Spacing.lg,
    },
    orderPlanName: {
        fontSize: FontSize.base,
        fontWeight: '700',
        color: Colors.olive[600],
    },
    orderLabel: {
        fontSize: FontSize.sm,
        color: Colors.olive[300],
        marginTop: 2,
    },
    orderAmount: {
        fontSize: FontSize['2xl'],
        fontWeight: '700',
        color: Colors.olive[600],
        marginTop: Spacing.sm,
    },
    orderGstLine: {
        fontFamily: 'PlusJakartaSans_400Regular',
        fontSize: FontSize.xs,
        color: Colors.secondaryText,
        marginTop: Spacing.xs,
    },

    // Form
    formSection: {
        marginBottom: Spacing.lg,
    },
    gatewayRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
        backgroundColor: Colors.peach[100],
        borderWidth: 1,
        borderColor: Alpha.peach400_20,
        borderRadius: BorderRadius.xl,
        padding: Spacing.md,
    },
    gatewayIcon: {
        width: 44,
        height: 44,
        borderRadius: BorderRadius.full,
        backgroundColor: Alpha.terra400_10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    gatewayTitle: {
        fontSize: FontSize.base,
        fontWeight: '700',
        color: Colors.olive[600],
    },
    gatewaySubtitle: {
        fontSize: FontSize.sm,
        color: Colors.olive[300],
        marginTop: 2,
    },
    inputLabel: {
        fontSize: FontSize.xs,
        fontWeight: '700',
        color: Colors.olive[400],
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: Spacing.sm,
        marginTop: Spacing.md,
    },
    formInput: {
        backgroundColor: Colors.peach[100],
        borderWidth: 1,
        borderColor: Alpha.peach400_20,
        borderRadius: BorderRadius.xl,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.md - 4,
        fontSize: FontSize.base,
        color: Colors.olive[600],
    },
    inputWithIcon: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.peach[100],
        borderWidth: 1,
        borderColor: Alpha.peach400_20,
        borderRadius: BorderRadius.xl,
        paddingHorizontal: Spacing.md,
    },
    inputIcon: {
        marginRight: Spacing.sm,
    },
    inputWithIconField: {
        flex: 1,
        paddingVertical: Spacing.md - 4,
        fontSize: FontSize.base,
        color: Colors.olive[600],
    },
    cardBrand: {
        fontSize: FontSize.xs,
        fontWeight: '700',
        color: Colors.olive[400],
    },
    twoColRow: {
        flexDirection: 'row',
        gap: Spacing.sm + 4,
    },
    halfCol: {
        flex: 1,
    },

    // Security footer
    securityFooter: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: Spacing.md,
    },
    securityText: {
        fontSize: FontSize['2xs'],
        color: Alpha.olive300_50,
    },

    // Success
    successContainer: {
        alignItems: 'center',
        paddingTop: Spacing['2xl'],
    },
    successIconWrap: {
        marginBottom: Spacing.lg,
    },
    successTitle: {
        fontSize: FontSize['3xl'],
        fontWeight: '800',
        color: Colors.olive[600],
        marginBottom: Spacing.lg,
    },
    successSummary: {
        backgroundColor: Alpha.peach200_30,
        borderRadius: BorderRadius['2xl'],
        padding: Spacing.lg - 4,
        width: '100%',
        marginBottom: Spacing.lg,
    },
    summaryRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: Spacing.sm + 2,
    },
    summaryLabel: {
        fontSize: FontSize.sm,
        color: Colors.olive[300],
    },
    summaryValue: {
        fontSize: FontSize.sm,
        fontWeight: '700',
        color: Colors.olive[600],
    },
    summaryDivider: {
        height: 1,
        backgroundColor: Alpha.peach400_12,
    },
});
