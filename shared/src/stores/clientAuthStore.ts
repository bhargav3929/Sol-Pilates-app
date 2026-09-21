import { create } from 'zustand'
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
    updateProfile,
    GoogleAuthProvider,
    OAuthProvider,
    signInWithPopup,
    signInWithCredential,
    User as FirebaseUser,
} from 'firebase/auth'
import { doc, getDoc, setDoc, onSnapshot, runTransaction, serverTimestamp, type Unsubscribe } from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import { ClientUser } from '../types/client'
import {
    DEFAULT_SUBSCRIPTION,
    DEFAULT_STATS,
    mapFirebaseError,
    buildClientUser,
    makeFallbackUser,
} from './clientAuthStore.helpers'
import { normalizePhone, PHONE_VALIDATION_MESSAGE } from '../utils/phone'

interface ClientAuthState {
    isAuthenticated: boolean
    isLoading: boolean
    clientUser: ClientUser | null
    firebaseUser: FirebaseUser | null
    initAuth: () => () => void
    startProfileListener: () => () => void
    loginClient: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
    signupClient: (email: string, password: string, name: string, phone: string) => Promise<{ success: boolean; error?: string }>
    savePhone: (phone: string) => Promise<{ success: boolean; error?: string }>
    googleSignIn: () => Promise<{ success: boolean; error?: string; isNewUser?: boolean }>
    googleSignInWithIdToken: (idToken: string, accessToken?: string) => Promise<{ success: boolean; error?: string; isNewUser?: boolean }>
    appleSignInWithIdentityToken: (identityToken: string, rawNonce: string, name?: string | null) => Promise<{ success: boolean; error?: string; isNewUser?: boolean }>
    logoutClient: () => Promise<void>
    refreshSubscription: () => Promise<void>
}

async function fetchClientProfile(uid: string): Promise<ClientUser | null> {
    try {
        const docRef = doc(db, 'users', uid)
        const docSnap = await getDoc(docRef)
        if (docSnap.exists()) {
            const data = docSnap.data() as Record<string, unknown>
            await backfillClientProfile(uid, data)
            return buildClientUser(uid, data)
        }
        return null
    } catch {
        return null
    }
}

type ClientAuthSetter = (
    partial:
        | Partial<ClientAuthState>
        | ((state: ClientAuthState) => Partial<ClientAuthState>),
) => void

async function finalizeProviderLogin(
    user: FirebaseUser,
    set: ClientAuthSetter,
    fallbackName?: string | null,
): Promise<{ success: boolean; error?: string; isNewUser?: boolean }> {
    let profile = await fetchClientProfile(user.uid)
    const isNewUser = !profile
    if (!profile) {
        profile = await createClientProfile(
            user.uid,
            user.email || '',
            user.displayName || fallbackName || 'Member',
        )
    } else if (fallbackName && (!profile.name || profile.name === 'Member')) {
        const nextName = user.displayName || fallbackName
        try {
            await setDoc(doc(db, 'users', user.uid), {
                name: nextName,
                updatedAt: serverTimestamp(),
            }, { merge: true })
            profile = { ...profile, name: nextName }
        } catch {
            profile = { ...profile, name: nextName }
        }
    }
    set({ isAuthenticated: true, clientUser: profile, firebaseUser: user })
    return { success: true, isNewUser }
}

async function createClientProfile(uid: string, email: string, name: string, phone?: string | null): Promise<ClientUser> {
    const profileData = {
        uid,
        email,
        name,
        ...(phone ? { phone } : {}),
        age: 0,
        fitnessGoals: [],
        profilePictureUrl: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        subscription: { ...DEFAULT_SUBSCRIPTION },
        stats: { ...DEFAULT_STATS },
    }
    const fallback: ClientUser = {
        id: uid,
        name,
        email,
        ...(phone ? { phone } : {}),
        subscription: { ...DEFAULT_SUBSCRIPTION },
        stats: { ...DEFAULT_STATS },
    }
    try {
        // A profile is only ever created once. If a document already exists
        // (for example the read that led here failed, or the onUserCreate
        // function won the race) we must not write a default subscription over
        // a plan the member may already have paid for.
        return await runTransaction(db, async (transaction) => {
            const ref = doc(db, 'users', uid)
            const existing = await transaction.get(ref)
            if (existing.exists()) {
                return buildClientUser(uid, existing.data() as Record<string, unknown>)
            }
            transaction.set(ref, profileData)
            return fallback
        })
    } catch {
        // Firestore write may fail if rules aren't set up yet — still return the profile
        return fallback
    }
}

async function backfillClientProfile(uid: string, data: Record<string, unknown>) {
    const patch: Record<string, unknown> = {}

    if (!data.uid) patch.uid = uid
    if (!data.createdAt) patch.createdAt = serverTimestamp()
    if (!data.updatedAt) patch.updatedAt = serverTimestamp()
    if (!data.fitnessGoals) patch.fitnessGoals = []
    if (data.age === undefined) patch.age = 0
    const subscription = data.subscription as Record<string, unknown> | undefined
    if (!subscription) {
        patch.subscription = { ...DEFAULT_SUBSCRIPTION }
    } else {
        const subscriptionPatch: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(DEFAULT_SUBSCRIPTION)) {
            if (subscription[key] === undefined) subscriptionPatch[key] = value
        }
        if (Object.keys(subscriptionPatch).length > 0) {
            patch.subscription = { ...subscription, ...subscriptionPatch }
        }
    }

    const stats = data.stats as Record<string, unknown> | undefined
    if (!stats) {
        patch.stats = { ...DEFAULT_STATS }
    } else {
        const statsPatch: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(DEFAULT_STATS)) {
            if (stats[key] === undefined) statsPatch[key] = value
        }
        if (Object.keys(statsPatch).length > 0) {
            patch.stats = { ...stats, ...statsPatch }
        }
    }

    if (Object.keys(patch).length === 0) return

    try {
        await setDoc(doc(db, 'users', uid), patch, { merge: true })
    } catch {
        // Ignore client-side backfill failures; auth can still proceed.
    }
}

export const useClientAuthStore = create<ClientAuthState>()((set, get) => ({
    isAuthenticated: false,
    isLoading: true,
    clientUser: null,
    firebaseUser: null,

    initAuth: () => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
                const profile = await fetchClientProfile(firebaseUser.uid)
                const clientUser: ClientUser = profile || makeFallbackUser(firebaseUser.uid, firebaseUser.displayName, firebaseUser.email)
                set({
                    isAuthenticated: true,
                    isLoading: false,
                    clientUser,
                    firebaseUser,
                })
            } else {
                set({
                    isAuthenticated: false,
                    isLoading: false,
                    clientUser: null,
                    firebaseUser: null,
                })
            }
        })
        return unsubscribe
    },

    // Real-time Firestore listener — keeps clientUser in sync with DB at all times.
    // When the booking API decrements classesRemaining in Firestore, this listener
    // fires and updates the Zustand store automatically within ~1 second.
    startProfileListener: () => {
        const { firebaseUser } = get()
        if (!firebaseUser) return () => {}
        const userRef = doc(db, 'users', firebaseUser.uid)
        const unsub: Unsubscribe = onSnapshot(userRef, (snap) => {
            if (!snap.exists()) return
            const data = snap.data() as Record<string, unknown>
            const updated = buildClientUser(firebaseUser.uid, data)
            set({ clientUser: updated })
        })
        return unsub
    },

    loginClient: async (email, password) => {
        try {
            const result = await signInWithEmailAndPassword(auth, email, password)
            const profile = await fetchClientProfile(result.user.uid)
            const clientUser: ClientUser = profile || makeFallbackUser(result.user.uid, result.user.displayName, result.user.email)
            set({
                isAuthenticated: true,
                clientUser,
                firebaseUser: result.user,
            })
            return { success: true }
        } catch (err: unknown) {
            const code = (err as { code?: string }).code || ''
            return { success: false, error: mapFirebaseError(code) }
        }
    },

    signupClient: async (email, password, name, phone) => {
        const normalizedPhone = normalizePhone(phone)
        if (!normalizedPhone) {
            return { success: false, error: PHONE_VALIDATION_MESSAGE }
        }
        try {
            const result = await createUserWithEmailAndPassword(auth, email, password)
            await updateProfile(result.user, { displayName: name })
            const clientUser = await createClientProfile(result.user.uid, email, name, normalizedPhone)
            set({
                isAuthenticated: true,
                clientUser,
                firebaseUser: result.user,
            })
            return { success: true }
        } catch (err: unknown) {
            const code = (err as { code?: string }).code || ''
            return { success: false, error: mapFirebaseError(code) }
        }
    },

    googleSignIn: async () => {
        try {
            const provider = new GoogleAuthProvider()
            const result = await signInWithPopup(auth, provider)
            return await finalizeProviderLogin(result.user, set)
        } catch (err: unknown) {
            const code = (err as { code?: string }).code || ''
            return { success: false, error: mapFirebaseError(code) }
        }
    },

    googleSignInWithIdToken: async (idToken: string, accessToken?: string) => {
        if (!idToken) return { success: false, error: 'Missing idToken' }
        try {
            const credential = GoogleAuthProvider.credential(idToken, accessToken)
            const result = await signInWithCredential(auth, credential)
            return await finalizeProviderLogin(result.user, set)
        } catch (err: unknown) {
            const code = (err as { code?: string }).code || ''
            return { success: false, error: mapFirebaseError(code) }
        }
    },

    appleSignInWithIdentityToken: async (identityToken: string, rawNonce: string, name?: string | null) => {
        if (!identityToken) return { success: false, error: 'Missing Apple identity token' }
        if (!rawNonce) return { success: false, error: 'Missing Apple nonce' }
        try {
            const provider = new OAuthProvider('apple.com')
            const credential = provider.credential({
                idToken: identityToken,
                rawNonce,
            })
            const result = await signInWithCredential(auth, credential)
            return await finalizeProviderLogin(result.user, set, name)
        } catch (err: unknown) {
            const code = (err as { code?: string }).code || ''
            return { success: false, error: mapFirebaseError(code) }
        }
    },

    // Used by the phone-capture gate: social sign-ups and pre-existing members
    // never went through the signup form, so this is where they supply a number.
    savePhone: async (phone: string) => {
        const { firebaseUser, clientUser } = get()
        if (!firebaseUser) return { success: false, error: 'You are not signed in.' }

        const normalizedPhone = normalizePhone(phone)
        if (!normalizedPhone) return { success: false, error: PHONE_VALIDATION_MESSAGE }

        try {
            await setDoc(doc(db, 'users', firebaseUser.uid), {
                phone: normalizedPhone,
                updatedAt: serverTimestamp(),
            }, { merge: true })
            if (clientUser) set({ clientUser: { ...clientUser, phone: normalizedPhone } })
            return { success: true }
        } catch {
            return { success: false, error: 'Could not save your number. Please try again.' }
        }
    },

    logoutClient: async () => {
        await signOut(auth)
        set({
            isAuthenticated: false,
            clientUser: null,
            firebaseUser: null,
        })
    },

    refreshSubscription: async () => {
        const { firebaseUser } = get()
        if (!firebaseUser) return
        const profile = await fetchClientProfile(firebaseUser.uid)
        if (profile) {
            set({ clientUser: profile })
        }
    },
}))
