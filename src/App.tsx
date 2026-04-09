import React, { useState, useEffect, useRef } from 'react';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  deleteUser,
  User as FirebaseUser,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  onSnapshot, 
  query, 
  orderBy,
  where,
  updateDoc,
  addDoc,
  deleteDoc,
  serverTimestamp,
  getDocFromServer,
  getDocsFromServer,
  limit
} from 'firebase/firestore';

// --- Constants ---
const MASTER_CLASSES = [
  "X TKJ A", "X TKJ B", "X TKJ C",
  "XI TKJ A", "XI TKJ B", "XI TKJ C",
  "XII TKJ A", "XII TKJ B", "XII TKJ C",
  "X RPL A", "X RPL B",
  "XI RPL A", "XI RPL B",
  "XII RPL A", "XII RPL B",
  "X TSM A", "X TSM B",
  "XI TSM A", "XI TSM B",
  "XII TSM A", "XII TSM B"
];

const getTodayString = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
import { auth, db } from './firebase';
import { LogIn, UserPlus, LogOut, Plus, Edit2, User as UserIcon, ClipboardList, CheckCircle2, AlertCircle, Trash2, Camera, X, MessageSquare, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';

// --- Types & Interfaces ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // toast.error(`Firestore Error (${operationType}): ${errInfo.error}`);
  throw new Error(JSON.stringify(errInfo));
}

// --- Types ---
interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: 'teacher' | 'admin';
  username?: string;
}

interface ClassMBG {
  id: string;
  className: string;
  studentCount: number;
  isFilled: boolean;
  date: string; // YYYY-MM-DD
  lastUpdatedBy?: string;
  lastUpdatedByName?: string;
  lastUpdatedByPhoto?: string;
  updatedAt?: any;
}

interface Message {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  senderPhoto: string;
  createdAt: any;
  isEdited?: boolean;
}

// --- Components ---

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  useEffect(() => {
    const handleError = (e: ErrorEvent) => {
      console.error("Caught error:", e.error);
      setHasError(true);
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Waduh, ada masalah!</h1>
          <p className="text-gray-600 mb-6">Terjadi kesalahan pada aplikasi. Coba refresh halaman ya.</p>
          <button onClick={() => window.location.reload()} className="bg-red-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-red-700 transition-colors">
            Refresh Halaman
          </button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<ClassMBG[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [view, setView] = useState<'beranda' | 'profil' | 'admin' | 'chat' | 'auth'>('auth');
  const [isRegistering, setIsRegistering] = useState(false);
  const [isAuthProcessing, setIsAuthProcessing] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editMessageText, setEditMessageText] = useState('');
  const [modalOpen, setModalOpen] = useState<'add' | 'edit' | 'profile' | 'delete' | 'clearChat' | 'deleteAccount' | null>(null);
  const [selectedClass, setSelectedClass] = useState<ClassMBG | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [tempCount, setTempCount] = useState<string>('');
  const [tempClassName, setTempClassName] = useState<string>('');
  const [tempDisplayName, setTempDisplayName] = useState<string>('');
  const [tempPhotoURL, setTempPhotoURL] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Connection Test
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error: any) {
        if (error.message?.includes('the client is offline')) {
          toast.error("Koneksi Firebase bermasalah. Pastikan konfigurasi benar.");
        }
      }
    }
    testConnection();
  }, []);

  // Auth State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          const docRef = doc(db, 'users', firebaseUser.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            let data = docSnap.data() as UserProfile;
            
            // FORCE Admin if email matches (in case it was stuck as teacher)
            if (firebaseUser.email === 'egimmm12@gmail.com' || firebaseUser.email === 'admin@mbg.app') {
              if (data.role !== 'admin') {
                data.role = 'admin';
                await setDoc(docRef, { role: 'admin' }, { merge: true });
              }
            }
            
            setProfile(data);
            setView(data.role === 'admin' ? 'admin' : 'beranda');
          } else {
            // Jika login Google atau Email tapi belum ada profil di Firestore
            const role = (firebaseUser.email === 'egimmm12@gmail.com' || firebaseUser.email === 'admin@mbg.app') ? 'admin' : 'teacher';
            const newProfile: UserProfile = {
              uid: firebaseUser.uid,
              email: firebaseUser.email || '',
              displayName: firebaseUser.displayName || (role === 'admin' ? 'Administrator MBG' : 'Guru'),
              photoURL: firebaseUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${firebaseUser.uid}`,
              role
            };
            await setDoc(docRef, {
              ...newProfile,
              createdAt: serverTimestamp()
            });
            setProfile(newProfile);
            setView(role === 'admin' ? 'admin' : 'beranda');
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`);
        }
      } else {
        setUser(null);
        setProfile(null);
        setView('auth');
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Real-time Classes (Daily)
  useEffect(() => {
    if (!user) return;
    const today = getTodayString();
    const q = query(
      collection(db, 'classes'), 
      where('date', '==', today),
      orderBy('className', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const classData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ClassMBG));
      setClasses(classData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'classes');
    });
    return unsubscribe;
  }, [user]);

  // Real-time Users (Admin Only)
  useEffect(() => {
    if (!user || profile?.role !== 'admin') {
      setAllUsers([]);
      return;
    }
    const q = query(collection(db, 'users'), orderBy('role', 'asc'), orderBy('displayName', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const userData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setAllUsers(userData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });
    return unsubscribe;
  }, [user, profile]);

  // Real-time Chat
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(50)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
      setMessages(msgData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'messages');
    });
    return unsubscribe;
  }, [user]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, view]);

  const handleGoogleLogin = async () => {
    if (isAuthProcessing) return;
    setIsAuthProcessing(true);
    const provider = new GoogleAuthProvider();
    try {
      const res = await signInWithPopup(auth, provider);
      
      // Auto-Admin for the owner
      if (res.user.email === 'egimmm12@gmail.com' || res.user.email === 'admin@mbg.app') {
        const userRef = doc(db, 'users', res.user.uid);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists() || userSnap.data().role !== 'admin') {
          const role = 'admin';
          const profileData = {
            uid: res.user.uid,
            email: res.user.email || '',
            displayName: res.user.displayName || 'Administrator MBG',
            photoURL: res.user.photoURL || '',
            role: role as 'admin'
          };
          
          await setDoc(userRef, {
            ...profileData,
            createdAt: serverTimestamp()
          }, { merge: true });
          
          setProfile(profileData);
          setView('admin');
        } else {
          // If already admin, still set the view
          setView('admin');
        }
      }
      
      toast.success("Berhasil masuk dengan Google!");
    } catch (error: any) {
      if (error.code === 'auth/popup-blocked') {
        toast.error("Popup diblokir oleh browser. Silakan izinkan popup untuk login.");
      } else if (error.code === 'auth/cancelled-popup-request') {
        // User closed the popup or multiple requests
      } else {
        console.error("Google Auth Error:", error);
        toast.error("Gagal login Google: " + error.message);
      }
    } finally {
      setIsAuthProcessing(false);
    }
  };

  const handleAuth = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;
    const name = formData.get('name') as string;

    // Simulate email for Firebase Auth
    const simulatedEmail = `${username.toLowerCase().trim()}@mbg.app`;

    try {
      if (isRegistering) {
        if (username.toLowerCase().trim() === 'admin') {
          toast.error("Username 'admin' sudah dipesan.");
          return;
        }
        
        const res = await createUserWithEmailAndPassword(auth, simulatedEmail, password);
        const newProfile: UserProfile = {
          uid: res.user.uid,
          email: simulatedEmail,
          displayName: name,
          photoURL: `https://api.dicebear.com/7.x/avataaars/svg?seed=${res.user.uid}`,
          role: 'teacher'
        };
        await setDoc(doc(db, 'users', res.user.uid), {
          ...newProfile,
          username: username.toLowerCase().trim(),
          createdAt: serverTimestamp()
        }).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${res.user.uid}`));
        setProfile(newProfile);
        toast.success("Registrasi berhasil!");
        setView('beranda');
      } else {
        // Special Admin Bootstrap: If logging in as admin for the first time
        if (username.toLowerCase().trim() === 'admin' && password === 'admin123') {
          try {
            await signInWithEmailAndPassword(auth, simulatedEmail, password);
          } catch (err: any) {
            if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found') {
              // Create the admin account if it doesn't exist
              const res = await createUserWithEmailAndPassword(auth, simulatedEmail, password);
              const adminProfile: UserProfile = {
                uid: res.user.uid,
                email: simulatedEmail,
                displayName: 'Administrator MBG',
                photoURL: `https://api.dicebear.com/7.x/avataaars/svg?seed=admin`,
                role: 'admin'
              };
              await setDoc(doc(db, 'users', res.user.uid), {
                ...adminProfile,
                username: 'admin',
                createdAt: serverTimestamp()
              }).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${res.user.uid}`));
              setProfile(adminProfile);
              setView('admin');
              toast.success("Admin Bootstrap Berhasil!");
              return;
            }
            throw err;
          }
        }
        await signInWithEmailAndPassword(auth, simulatedEmail, password);
        toast.success("Login berhasil!");
      }
    } catch (error: any) {
      console.error("Auth Error:", error.code, error.message);
      if (error.code === 'auth/operation-not-allowed') {
        toast.error("Login Username belum diaktifkan. Silakan gunakan 'Masuk dengan Google' di bawah.", {
          duration: 6000
        });
      } else if (error.code === 'auth/email-already-in-use') {
        toast.error("Email sudah terdaftar.");
      } else if (error.code === 'auth/weak-password') {
        toast.error("Password terlalu lemah (minimal 6 karakter).");
      } else if (error.code === 'auth/invalid-credential') {
        toast.error("Email atau password salah.");
      } else {
        toast.error(error.message);
      }
    }
  };

  const handleUpdateClick = (cls: ClassMBG) => {
    const canEdit = profile?.role === 'admin' || !cls.isFilled || cls.lastUpdatedBy === user?.uid;
    
    if (!canEdit) {
      toast.error("Hanya guru yang mengisi data ini atau Admin yang bisa mengubahnya!");
      return;
    }
    setSelectedClass(cls);
    setTempCount(cls.studentCount.toString());
    setModalOpen('edit');
  };

  const submitUpdate = async () => {
    const count = parseInt(tempCount);
    if (!selectedClass || isNaN(count) || isSubmitting) return;
    if (count < 0) {
      toast.error("Jumlah siswa tidak boleh minus!");
      return;
    }

    setIsSubmitting(true);
    try {
      await updateDoc(doc(db, 'classes', selectedClass.id), {
        studentCount: parseInt(tempCount),
        isFilled: true,
        lastUpdatedBy: user?.uid,
        lastUpdatedByName: profile?.displayName,
        lastUpdatedByPhoto: profile?.photoURL || '',
        updatedAt: serverTimestamp()
      });
      toast.success("Data berhasil diperbarui!");
      setModalOpen(null);
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `classes/${selectedClass.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitNewClass = async () => {
    const count = parseInt(tempCount);
    if (!tempClassName.trim() || isNaN(count) || isSubmitting) {
      if (!isSubmitting) toast.error("Pilih kelas dan masukkan jumlah siswa!");
      return;
    }

    if (count < 0) {
      toast.error("Jumlah siswa tidak boleh minus!");
      return;
    }

    setIsSubmitting(true);
    const today = getTodayString();

    try {
      await addDoc(collection(db, 'classes'), {
        className: tempClassName.trim(),
        studentCount: count || 0,
        isFilled: true,
        date: today,
        lastUpdatedBy: user?.uid,
        lastUpdatedByName: profile?.displayName,
        lastUpdatedByPhoto: profile?.photoURL || '',
        updatedAt: serverTimestamp()
      });
      toast.success("Data MBG berhasil dikirim!");
      setModalOpen(null);
      setTempClassName('');
      setTempCount('');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.CREATE, 'classes');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClick = (cls: ClassMBG) => {
    setSelectedClass(cls);
    setModalOpen('delete');
  };

  const submitDelete = async () => {
    if (!selectedClass || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await deleteDoc(doc(db, 'classes', selectedClass.id));
      toast.success("Kelas berhasil dihapus!");
      setModalOpen(null);
    } catch (error: any) {
      handleFirestoreError(error, OperationType.DELETE, `classes/${selectedClass.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user || isSubmitting) return;

    // If admin is deleting someone else
    const targetUser = selectedUser || profile;
    if (!targetUser) return;

    const isSelf = targetUser.uid === user.uid;

    setIsSubmitting(true);
    try {
      // 1. Delete Firestore document
      await deleteDoc(doc(db, 'users', targetUser.uid));

      // 2. If self-deleting, try to delete from Auth
      if (isSelf) {
        try {
          await deleteUser(user);
          toast.success("Akun Anda berhasil dihapus.");
        } catch (authErr: any) {
          console.error("Auth Delete Error:", authErr);
          if (authErr.code === 'auth/requires-recent-login') {
            toast.error("Untuk keamanan, silakan login ulang sebelum menghapus akun.");
            await signOut(auth);
            return;
          }
          // If auth delete fails but firestore is gone, we still sign out
          await signOut(auth);
        }
      } else {
        toast.success(`Akun ${targetUser.displayName} berhasil dihapus dari database.`);
      }
      
      setModalOpen(null);
      setSelectedUser(null);
    } catch (error: any) {
      handleFirestoreError(error, OperationType.DELETE, `users/${targetUser.uid}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 1024 * 1024) { // 1MB limit for base64
        toast.error("Ukuran file terlalu besar (maks 1MB)");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setTempPhotoURL(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const submitProfileUpdate = async () => {
    if (!user || !tempDisplayName.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        displayName: tempDisplayName.trim(),
        photoURL: tempPhotoURL.trim()
      });
      setProfile(prev => prev ? { ...prev, displayName: tempDisplayName, photoURL: tempPhotoURL } : null);
      toast.success("Profil berhasil diperbarui!");
      setModalOpen(null);
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !user || !profile) return;

    try {
      await addDoc(collection(db, 'messages'), {
        text: newMessage.trim(),
        senderId: user.uid,
        senderName: profile.displayName,
        senderPhoto: profile.photoURL || '',
        createdAt: serverTimestamp()
      });
      setNewMessage('');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.CREATE, 'messages');
    }
  };

  const startEditMessage = (msg: Message) => {
    setEditingMessageId(msg.id);
    setEditMessageText(msg.text);
  };

  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditMessageText('');
  };

  const submitEditMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMessageId || !editMessageText.trim()) return;

    try {
      await updateDoc(doc(db, 'messages', editingMessageId), {
        text: editMessageText.trim(),
        isEdited: true,
        updatedAt: serverTimestamp()
      });
      setEditingMessageId(null);
      setEditMessageText('');
      toast.success("Pesan diperbarui!");
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `messages/${editingMessageId}`);
    }
  };

  const deleteAllMessages = async () => {
    if (profile?.role !== 'admin' || isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      const batchSize = 50;
      const q = query(collection(db, 'messages'), limit(batchSize));
      const snapshot = await getDocsFromServer(q);
      
      if (snapshot.empty) {
        toast.info("Tidak ada pesan untuk dihapus.");
        setModalOpen(null);
        return;
      }

      const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);
      
      toast.success(`Berhasil menghapus ${snapshot.docs.length} pesan.`);
      setModalOpen(null);
    } catch (error: any) {
      handleFirestoreError(error, OperationType.DELETE, 'messages');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
        <Toaster position="top-center" richColors />
        
        {/* Navigation */}
        {user && (
          <nav className="bg-white border-b border-slate-200 sticky top-0 z-10">
            <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-xl text-indigo-600">
                <ClipboardList className="w-6 h-6" />
                <span>MBG List</span>
              </div>
              <div className="flex items-center gap-4">
                {profile?.role === 'admin' && (
                  <button 
                    onClick={() => setView('admin')}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${view === 'admin' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    Admin
                  </button>
                )}
                <button 
                  onClick={() => setView('beranda')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${view === 'beranda' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  Beranda
                </button>
                <button 
                  onClick={() => setView('chat')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${view === 'chat' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  Chat Guru
                </button>
                <button 
                  onClick={() => setView('profil')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${view === 'profil' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  Profil
                </button>
                <button 
                  onClick={() => signOut(auth)}
                  className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                  title="Logout"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            </div>
          </nav>
        )}

        <main className="max-w-5xl mx-auto p-4 md:p-8">
          <AnimatePresence mode="wait">
            {view === 'auth' && (
              <motion.div 
                key="auth"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-md mx-auto mt-12"
              >
                <div className="bg-white p-8 rounded-2xl shadow-xl border border-slate-100">
                  <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      {isRegistering ? <UserPlus className="w-8 h-8" /> : <LogIn className="w-8 h-8" />}
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900">
                      {isRegistering ? 'Daftar Akun Guru' : 'Login Guru'}
                    </h1>
                    <p className="text-slate-500 mt-2">Akses portal manajemen MBG List</p>
                  </div>

                  <form onSubmit={handleAuth} className="space-y-4">
                    {isRegistering && (
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Nama Lengkap</label>
                        <input name="name" type="text" required className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all" />
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
                      <input name="username" type="text" placeholder="Masukkan username" required className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                      <input name="password" type="password" required className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all" />
                    </div>
                    <button type="submit" className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-semibold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-100">
                      {isRegistering ? 'Daftar Sekarang' : 'Masuk'}
                    </button>
                  </form>

                  <div className="mt-6 flex items-center gap-4">
                    <div className="flex-1 h-px bg-slate-100"></div>
                    <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Atau</span>
                    <div className="flex-1 h-px bg-slate-100"></div>
                  </div>

                  <button 
                    onClick={handleGoogleLogin}
                    disabled={isAuthProcessing}
                    className="w-full mt-6 flex items-center justify-center gap-3 bg-white border border-slate-200 text-slate-700 py-2.5 rounded-lg font-semibold hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isAuthProcessing ? (
                      <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-indigo-600"></div>
                    ) : (
                      <>
                        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" referrerPolicy="no-referrer" />
                        <span>Masuk dengan Google</span>
                      </>
                    )}
                  </button>

                  <div className="mt-6 text-center">
                    <button 
                      onClick={() => setIsRegistering(!isRegistering)}
                      className="text-sm text-indigo-600 font-medium hover:underline"
                    >
                      {isRegistering ? 'Sudah punya akun? Login' : 'Belum punya akun? Daftar'}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {view === 'admin' && profile?.role === 'admin' && (
              <motion.div 
                key="admin"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-8"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-2xl font-bold text-slate-900">Dashboard Admin</h1>
                    <p className="text-slate-500">Ringkasan data MBG hari ini: {getTodayString()}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <p className="text-sm font-medium text-slate-500 mb-1">Total Kelas Terdata</p>
                    <p className="text-3xl font-bold text-indigo-600">{classes.length} / {MASTER_CLASSES.length}</p>
                  </div>
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <p className="text-sm font-medium text-slate-500 mb-1">Total Siswa Makan</p>
                    <p className="text-3xl font-bold text-emerald-600">
                      {classes.reduce((acc, curr) => acc + curr.studentCount, 0)}
                    </p>
                  </div>
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <p className="text-sm font-medium text-slate-500 mb-1">Kelas Belum Lapor</p>
                    <p className="text-3xl font-bold text-orange-600">
                      {MASTER_CLASSES.length - classes.length}
                    </p>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-slate-100">
                    <h3 className="font-bold text-slate-900">Rincian Laporan Per Kelas</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Kelas</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Jumlah Siswa</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Guru Pelapor</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Waktu Input</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {classes.map((cls) => (
                          <tr key={cls.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 font-bold text-slate-900">{cls.className}</td>
                            <td className="px-6 py-4 text-slate-600">{cls.studentCount} Siswa</td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                {cls.lastUpdatedByPhoto ? (
                                  <img src={cls.lastUpdatedByPhoto} className="w-6 h-6 rounded-full object-cover" alt="" />
                                ) : (
                                  <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center">
                                    <UserIcon className="w-3 h-3 text-slate-400" />
                                  </div>
                                )}
                                <span className="text-sm text-slate-600">{cls.lastUpdatedByName || 'Anonim'}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm text-slate-500">
                              {cls.updatedAt?.toDate ? cls.updatedAt.toDate().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'}
                            </td>
                          </tr>
                        ))}
                        {classes.length === 0 && (
                          <tr>
                            <td colSpan={4} className="px-6 py-12 text-center text-slate-400 italic">Belum ada data masuk hari ini.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="font-bold text-slate-900">Daftar Pengguna (Guru & Admin)</h3>
                    <span className="text-xs font-bold bg-indigo-100 text-indigo-600 px-2 py-1 rounded-full">
                      {allUsers.length} Total
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Nama</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Email / Username</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Jabatan</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {allUsers.map((u) => (
                          <tr key={u.uid} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                {u.photoURL ? (
                                  <img src={u.photoURL} className="w-8 h-8 rounded-full object-cover border border-slate-200" alt="" referrerPolicy="no-referrer" />
                                ) : (
                                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                                    <UserIcon className="w-4 h-4 text-slate-400" />
                                  </div>
                                )}
                                <span className="font-semibold text-slate-900">{u.displayName}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex flex-col">
                                <span className="text-sm text-slate-600">{u.email}</span>
                                {u.username && <span className="text-[10px] text-slate-400">@{u.username}</span>}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center justify-between">
                                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${
                                  u.role === 'admin' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'
                                }`}>
                                  {u.role}
                                </span>
                                {u.uid !== user?.uid && (
                                  <button 
                                    onClick={() => {
                                      setSelectedUser(u);
                                      setModalOpen('deleteAccount');
                                    }}
                                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                    title="Hapus User"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {view === 'chat' && (
              <motion.div 
                key="chat"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="max-w-3xl mx-auto h-[calc(100vh-12rem)] flex flex-col bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden"
              >
                <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
                      <MessageSquare className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="font-bold text-slate-900">Chat Guru MBG</h2>
                      <p className="text-[10px] text-slate-500 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                        Diskusi Real-time
                      </p>
                    </div>
                  </div>
                  {profile?.role === 'admin' && messages.length > 0 && (
                    <button 
                      onClick={() => setModalOpen('clearChat')}
                      className="text-xs font-semibold text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors border border-red-100"
                    >
                      Hapus Semua Chat
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/30">
                  {messages.map((msg) => (
                    <div 
                      key={msg.id} 
                      className={`flex items-start gap-3 ${msg.senderId === user?.uid ? 'flex-row-reverse' : ''}`}
                    >
                      <img 
                        src={msg.senderPhoto || `https://api.dicebear.com/7.x/avataaars/svg?seed=${msg.senderId}`} 
                        className="w-8 h-8 rounded-lg object-cover border border-slate-200"
                        alt=""
                        referrerPolicy="no-referrer"
                      />
                      <div className={`max-w-[70%] ${msg.senderId === user?.uid ? 'items-end' : 'items-start'} flex flex-col`}>
                        <span className="text-[10px] font-bold text-slate-400 mb-1 px-1">
                          {msg.senderName}
                        </span>
                        
                        {editingMessageId === msg.id ? (
                          <form onSubmit={submitEditMessage} className="w-full flex flex-col gap-2">
                            <input
                              autoFocus
                              type="text"
                              value={editMessageText}
                              onChange={(e) => setEditMessageText(e.target.value)}
                              className="w-full px-3 py-2 rounded-xl border border-indigo-300 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                            />
                            <div className="flex gap-2 justify-end">
                              <button 
                                type="button"
                                onClick={cancelEditMessage}
                                className="text-[10px] font-bold text-slate-400 hover:text-slate-600"
                              >
                                Batal
                              </button>
                              <button 
                                type="submit"
                                className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800"
                              >
                                Simpan
                              </button>
                            </div>
                          </form>
                        ) : (
                          <div className={`p-3 rounded-2xl text-sm shadow-sm relative group ${
                            msg.senderId === user?.uid 
                              ? 'bg-indigo-600 text-white rounded-tr-none' 
                              : 'bg-white text-slate-700 border border-slate-100 rounded-tl-none'
                          }`}>
                            {msg.text}
                            {msg.senderId === user?.uid && (
                              <button 
                                onClick={() => startEditMessage(msg)}
                                className="absolute -left-8 top-1/2 -translate-y-1/2 p-1 text-slate-300 hover:text-indigo-500 opacity-0 group-hover:opacity-100 transition-all"
                                title="Edit Pesan"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                        
                        <div className="flex items-center gap-2 mt-1 px-1">
                          <span className="text-[9px] text-slate-400">
                            {msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '...'}
                          </span>
                          {msg.isEdited && (
                            <span className="text-[9px] text-slate-300 italic">(diedit)</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                  {messages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2 opacity-50">
                      <MessageSquare className="w-12 h-12" />
                      <p className="text-sm italic">Belum ada pesan. Mulai obrolan!</p>
                    </div>
                  )}
                </div>

                <form onSubmit={sendMessage} className="p-4 bg-white border-t border-slate-100 flex gap-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Ketik pesan diskusi..."
                    className="flex-1 px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm"
                  />
                  <button 
                    type="submit"
                    disabled={!newMessage.trim()}
                    className="bg-indigo-600 text-white p-2 rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-100"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </form>
              </motion.div>
            )}
            {view === 'beranda' && (
              <motion.div 
                key="beranda"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-2xl font-bold text-slate-900">Daftar Kelas MBG</h1>
                    <p className="text-slate-500">Update harian: {new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                  </div>
                  <button 
                    onClick={() => setModalOpen('add')}
                    className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors shadow-md"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Tambah Kelas</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {classes.map((cls) => (
                    <motion.div 
                      layout
                      key={cls.id}
                      className={`bg-white p-5 rounded-2xl shadow-sm border transition-all ${cls.isFilled ? 'border-green-100 bg-green-50/30' : 'border-slate-100'}`}
                    >
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h3 className="font-bold text-lg text-slate-900">{cls.className}</h3>
                          <div className="flex items-center gap-1.5 mt-1">
                            {cls.isFilled ? (
                              <span className="flex items-center gap-1 text-xs font-semibold text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
                                <CheckCircle2 className="w-3 h-3" /> Terisi
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
                                <AlertCircle className="w-3 h-3" /> Belum Update
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          {(profile?.role === 'admin' || !cls.isFilled || cls.lastUpdatedBy === user?.uid) && (
                            <button 
                              onClick={() => handleUpdateClick(cls)}
                              className="p-2 rounded-lg text-indigo-600 hover:bg-indigo-50 transition-colors"
                              title="Edit Data"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                          
                          {profile?.role === 'admin' && (
                            <button 
                              onClick={() => handleDeleteClick(cls)}
                              className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                              title="Hapus Data"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex justify-between items-end">
                          <span className="text-sm text-slate-500">Jumlah Siswa</span>
                          <span className="text-3xl font-bold text-slate-900">{cls.studentCount}</span>
                        </div>
                        
                        {cls.lastUpdatedByName && (
                          <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
                            {cls.lastUpdatedByPhoto ? (
                              <img src={cls.lastUpdatedByPhoto} className="w-6 h-6 rounded-full object-cover border border-slate-200" alt="" referrerPolicy="no-referrer" />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center">
                                <UserIcon className="w-3 h-3 text-slate-400" />
                              </div>
                            )}
                            <div className="flex flex-col">
                              <span className="text-[10px] text-slate-400 leading-none">Update oleh:</span>
                              <span className="text-[11px] font-medium text-slate-600">{cls.lastUpdatedByName}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {view === 'profil' && (
              <motion.div 
                key="profil"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="max-w-2xl mx-auto"
              >
                <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
                  <div className="h-32 bg-indigo-600"></div>
                  <div className="px-8 pb-8">
                    <div className="relative -mt-12 mb-6 flex items-end justify-between">
                      <div className="w-24 h-24 bg-white rounded-2xl shadow-lg flex items-center justify-center p-1">
                        <div className="w-full h-full bg-slate-100 rounded-xl flex items-center justify-center text-indigo-600 overflow-hidden">
                          {profile?.photoURL ? (
                            <img src={profile.photoURL} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                          ) : (
                            <UserIcon className="w-12 h-12" />
                          )}
                        </div>
                      </div>
                      <button 
                        onClick={() => {
                          setTempDisplayName(profile?.displayName || '');
                          setTempPhotoURL(profile?.photoURL || '');
                          setModalOpen('profile');
                        }}
                        className="mb-2 flex items-center gap-2 bg-indigo-50 text-indigo-600 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-100 transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                        Edit Profil
                      </button>
                    </div>
                    
                    <h1 className="text-2xl font-bold text-slate-900">{profile?.displayName}</h1>
                    <p className="text-slate-500">@{ (profile as any)?.username || profile?.email.split('@')[0] }</p>
                    
                    <div className="mt-8 grid grid-cols-2 gap-4">
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Jabatan</span>
                        <p className="text-lg font-bold text-slate-900 capitalize">{profile?.role}</p>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Status Akses</span>
                        <p className="text-lg font-bold text-green-600">Aktif</p>
                      </div>
                    </div>

                    <div className="mt-8 pt-8 border-t border-slate-100">
                      <h3 className="font-bold text-slate-900 mb-4">Tentang Akses Guru</h3>
                      <p className="text-slate-600 text-sm leading-relaxed mb-6">
                        Sebagai guru, Anda memiliki akses untuk melihat seluruh daftar kelas dan memperbarui jumlah siswa untuk program Makan Bergizi Gratis (MBG). 
                        Pastikan data yang Anda masukkan akurat karena kelas yang sudah ditandai "Terisi" tidak dapat diubah kembali kecuali oleh administrator.
                      </p>
                      
                      <div className="mt-6 flex justify-center">
                        <button 
                          onClick={() => {
                            setSelectedUser(null);
                            setModalOpen('deleteAccount');
                          }}
                          className="text-xs text-slate-400 hover:text-red-500 transition-colors"
                        >
                          Hapus Akun
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Modals */}
        <AnimatePresence>
          {modalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setModalOpen(null)}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
              >
                <div className="p-6">
                  <h2 className="text-xl font-bold text-slate-900 mb-4">
                    {modalOpen === 'add' ? 'Tambah Kelas Baru' : 
                     modalOpen === 'edit' ? `Update Kelas: ${selectedClass?.className}` : 
                     modalOpen === 'delete' ? 'Hapus Kelas' :
                     modalOpen === 'deleteAccount' ? 'Hapus Akun' :
                     modalOpen === 'clearChat' ? 'Hapus Chat' :
                     'Edit Profil Saya'}
                  </h2>
                  
                  {modalOpen === 'add' ? (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Pilih Kelas</label>
                        <select 
                          value={tempClassName}
                          onChange={(e) => setTempClassName(e.target.value)}
                          className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                        >
                          <option value="">-- Pilih Kelas --</option>
                          {MASTER_CLASSES
                            .filter(mc => !classes.some(c => c.className === mc))
                            .map(mc => (
                              <option key={mc} value={mc}>{mc}</option>
                            ))
                          }
                        </select>
                        {MASTER_CLASSES.filter(mc => !classes.some(c => c.className === mc)).length === 0 && (
                          <p className="text-[10px] text-red-500 mt-1 italic">Semua kelas sudah mengisi data hari ini.</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Jumlah Siswa</label>
                        <input 
                          type="number" 
                          min="0"
                          placeholder="0"
                          value={tempCount}
                          onChange={(e) => setTempCount(e.target.value)}
                          className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                      </div>
                    </div>
                  ) : modalOpen === 'edit' ? (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Jumlah Siswa</label>
                        <input 
                          type="number" 
                          min="0"
                          value={tempCount}
                          onChange={(e) => setTempCount(e.target.value)}
                          className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                      </div>
                    </div>
                  ) : modalOpen === 'delete' ? (
                    <div className="space-y-4">
                      <p className="text-slate-600">
                        Apakah Anda yakin ingin menghapus kelas <span className="font-bold text-slate-900">{selectedClass?.className}</span>? 
                        Tindakan ini tidak dapat dibatalkan.
                      </p>
                    </div>
                  ) : modalOpen === 'clearChat' ? (
                    <div className="space-y-4">
                      <p className="text-slate-600">
                        Apakah Anda yakin ingin menghapus <span className="font-bold text-red-600">semua pesan chat</span>? 
                        Tindakan ini akan menghapus riwayat diskusi untuk semua guru dan tidak dapat dibatalkan.
                      </p>
                    </div>
                  ) : modalOpen === 'deleteAccount' ? (
                    <div className="space-y-4">
                      <p className="text-slate-600">
                        Apakah Anda yakin ingin menghapus akun <span className="font-bold text-red-600">{selectedUser?.displayName || profile?.displayName}</span>? 
                        {(!selectedUser || selectedUser.uid === user?.uid) ? 
                          " Seluruh data profil Anda akan dihapus permanen dari database." : 
                          " Akun guru ini akan dihapus dari database."}
                      </p>
                      <p className="text-xs text-slate-400 italic">Tindakan ini tidak dapat dibatalkan.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Nama Tampilan</label>
                        <input 
                          type="text" 
                          value={tempDisplayName}
                          onChange={(e) => setTempDisplayName(e.target.value)}
                          className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Foto Profil</label>
                        <div className="flex flex-col gap-3">
                          {tempPhotoURL && (
                            <div className="w-20 h-20 rounded-xl overflow-hidden border border-slate-200">
                              <img src={tempPhotoURL} className="w-full h-full object-cover" alt="Preview" />
                            </div>
                          )}
                          <div className="flex gap-2">
                            <label className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 font-medium cursor-pointer hover:bg-slate-100 transition-colors">
                              <Camera className="w-5 h-5" />
                              <span>Pilih dari Galeri/File</span>
                              <input 
                                type="file" 
                                accept="image/*" 
                                className="hidden" 
                                onChange={handleFileChange}
                              />
                            </label>
                            <button 
                              onClick={() => setTempPhotoURL(`https://api.dicebear.com/7.x/avataaars/svg?seed=${Date.now()}`)}
                              className="p-2 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                              title="Acak Avatar"
                            >
                              <UserIcon className="w-5 h-5 text-slate-600" />
                            </button>
                          </div>
                          <p className="text-[10px] text-slate-400 italic">*Maksimal ukuran file 1MB</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-8 flex gap-3">
                    <button 
                      onClick={() => setModalOpen(null)}
                      className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors"
                    >
                      Batal
                    </button>
                    <button 
                      disabled={isSubmitting}
                      onClick={
                        modalOpen === 'add' ? submitNewClass : 
                        modalOpen === 'edit' ? submitUpdate : 
                        modalOpen === 'delete' ? submitDelete :
                        modalOpen === 'deleteAccount' ? handleDeleteAccount :
                        modalOpen === 'clearChat' ? deleteAllMessages :
                        submitProfileUpdate
                      }
                      className={`flex-1 px-4 py-2 rounded-lg text-white font-medium transition-colors shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${modalOpen === 'delete' || modalOpen === 'clearChat' || modalOpen === 'deleteAccount' ? 'bg-red-600 hover:bg-red-700 shadow-red-100' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-100'}`}
                    >
                      {isSubmitting && <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>}
                      {modalOpen === 'delete' || modalOpen === 'clearChat' || modalOpen === 'deleteAccount' ? 'Hapus' : 'Simpan'}
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}
