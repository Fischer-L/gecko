/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "StorageManager.h"

#include "mozilla/dom/PromiseWorkerProxy.h"
#include "mozilla/dom/quota/QuotaManagerService.h"
#include "mozilla/dom/StorageManagerBinding.h"
#include "mozilla/dom/WorkerPrivate.h"
#include "mozilla/ErrorResult.h"
#include "nsContentPermissionHelper.h"
#include "nsIContentPermissionPrompt.h"
#include "nsIQuotaCallbacks.h"
#include "nsIQuotaRequests.h"
#include "nsPIDOMWindow.h"

using namespace mozilla::dom::workers;

namespace mozilla {
namespace dom {

namespace {

// This class is used to get quota usage callback.
class EstimateResolver final
  : public nsIQuotaUsageCallback
{
  class FinishWorkerRunnable;

  // If this resolver was created for a window then mPromise must be non-null.
  // Otherwise mProxy must be non-null.
  RefPtr<Promise> mPromise;
  RefPtr<PromiseWorkerProxy> mProxy;

  nsresult mResultCode;
  StorageEstimate mStorageEstimate;

public:
  explicit EstimateResolver(Promise* aPromise)
    : mPromise(aPromise)
    , mResultCode(NS_OK)
  {
    MOZ_ASSERT(NS_IsMainThread());
    MOZ_ASSERT(aPromise);
  }

  explicit EstimateResolver(PromiseWorkerProxy* aProxy)
    : mProxy(aProxy)
    , mResultCode(NS_OK)
  {
    MOZ_ASSERT(NS_IsMainThread());
    MOZ_ASSERT(aProxy);
  }

  void
  ResolveOrReject(Promise* aPromise);

  NS_DECL_THREADSAFE_ISUPPORTS

  NS_DECL_NSIQUOTAUSAGECALLBACK

private:
  ~EstimateResolver()
  { }
};

// This class is used to return promise on worker thread.
class EstimateResolver::FinishWorkerRunnable final
  : public WorkerRunnable
{
  RefPtr<EstimateResolver> mResolver;

public:
  explicit FinishWorkerRunnable(EstimateResolver* aResolver)
    : WorkerRunnable(aResolver->mProxy->GetWorkerPrivate())
    , mResolver(aResolver)
  {
    MOZ_ASSERT(NS_IsMainThread());
    MOZ_ASSERT(aResolver);
  }

  virtual bool
  WorkerRun(JSContext* aCx, WorkerPrivate* aWorkerPrivate) override;
};

class EstimateWorkerMainThreadRunnable
  : public WorkerMainThreadRunnable
{
  RefPtr<PromiseWorkerProxy> mProxy;

public:
  EstimateWorkerMainThreadRunnable(WorkerPrivate* aWorkerPrivate,
                                   PromiseWorkerProxy* aProxy)
    : WorkerMainThreadRunnable(aWorkerPrivate,
                               NS_LITERAL_CSTRING("StorageManager :: Estimate"))
    , mProxy(aProxy)
  {
    MOZ_ASSERT(aWorkerPrivate);
    aWorkerPrivate->AssertIsOnWorkerThread();
    MOZ_ASSERT(aProxy);
  }

  virtual bool
  MainThreadRun() override;
};

nsresult
GetUsageForPrincipal(nsIPrincipal* aPrincipal,
                     nsIQuotaUsageCallback* aCallback,
                     nsIQuotaUsageRequest** aRequest)
{
  MOZ_ASSERT(aPrincipal);
  MOZ_ASSERT(aCallback);
  MOZ_ASSERT(aRequest);

  nsCOMPtr<nsIQuotaManagerService> qms = QuotaManagerService::GetOrCreate();
  if (NS_WARN_IF(!qms)) {
    return NS_ERROR_FAILURE;
  }

  nsresult rv = qms->GetUsageForPrincipal(aPrincipal, aCallback, true, aRequest);
  if (NS_WARN_IF(NS_FAILED(rv))) {
    return rv;
  }

  return NS_OK;
};

nsresult
GetStorageEstimate(nsIQuotaUsageRequest* aRequest,
                   StorageEstimate& aStorageEstimate)
{
  MOZ_ASSERT(aRequest);

  uint64_t usage;
  nsresult rv = aRequest->GetUsage(&usage);
  if (NS_WARN_IF(NS_FAILED(rv))) {
    return rv;
  }

  uint64_t limit;
  rv = aRequest->GetLimit(&limit);
  if (NS_WARN_IF(NS_FAILED(rv))) {
    return rv;
  }

  aStorageEstimate.mUsage.Construct() = usage;
  aStorageEstimate.mQuota.Construct() = limit;
  return NS_OK;
}

} // namespace

/*******************************************************************************
 * Local class implementations
 ******************************************************************************/

void
EstimateResolver::ResolveOrReject(Promise* aPromise)
{
  MOZ_ASSERT(aPromise);

  if (NS_SUCCEEDED(mResultCode)) {
    aPromise->MaybeResolve(mStorageEstimate);
  } else {
    aPromise->MaybeReject(mResultCode);
  }
}

NS_IMPL_ISUPPORTS(EstimateResolver, nsIQuotaUsageCallback)

NS_IMETHODIMP
EstimateResolver::OnUsageResult(nsIQuotaUsageRequest *aRequest)
{
  MOZ_ASSERT(NS_IsMainThread());
  MOZ_ASSERT(aRequest);

  nsresult rv = aRequest->GetResultCode(&mResultCode);
  if (NS_WARN_IF(NS_FAILED(rv))) {
    mResultCode = rv;
  } else if (NS_SUCCEEDED(mResultCode)) {
    rv = GetStorageEstimate(aRequest, mStorageEstimate);
    if (NS_WARN_IF(NS_FAILED(rv))) {
      mResultCode = rv;
    }
  }

  // In a main thread request.
  if (!mProxy) {
    MOZ_ASSERT(mPromise);

    ResolveOrReject(mPromise);
    return NS_OK;
  }

  // In a worker thread request.
  MutexAutoLock lock(mProxy->Lock());

  if (NS_WARN_IF(mProxy->CleanedUp())) {
    return NS_ERROR_FAILURE;
  }

  RefPtr<FinishWorkerRunnable> runnable = new FinishWorkerRunnable(this);
  if (NS_WARN_IF(!runnable->Dispatch())) {
    return NS_ERROR_FAILURE;
  }

  return NS_OK;
}

bool
EstimateResolver::
FinishWorkerRunnable::WorkerRun(JSContext* aCx, WorkerPrivate* aWorkerPrivate)
{
  MOZ_ASSERT(aWorkerPrivate);
  aWorkerPrivate->AssertIsOnWorkerThread();

  RefPtr<PromiseWorkerProxy> proxy = mResolver->mProxy;
  MOZ_ASSERT(proxy);

  RefPtr<Promise> promise = proxy->WorkerPromise();
  MOZ_ASSERT(promise);

  mResolver->ResolveOrReject(promise);

  proxy->CleanUp();

  return true;
}

bool
EstimateWorkerMainThreadRunnable::MainThreadRun()
{
  MOZ_ASSERT(NS_IsMainThread());

  nsCOMPtr<nsIPrincipal> principal;

  {
    MutexAutoLock lock(mProxy->Lock());
    if (mProxy->CleanedUp()) {
      return true;
    }
    principal = mProxy->GetWorkerPrivate()->GetPrincipal();
  }

  MOZ_ASSERT(principal);

  RefPtr<EstimateResolver> resolver = new EstimateResolver(mProxy);

  RefPtr<nsIQuotaUsageRequest> request;
  nsresult rv =
    GetUsageForPrincipal(principal, resolver, getter_AddRefs(request));
  if (NS_WARN_IF(NS_FAILED(rv))) {
    return false;
  }

  return true;
}

/*******************************************************************************
 * PersistentStoragePermissionRequest
 ******************************************************************************/

class PersistentStoragePermissionRequest
  : public nsIContentPermissionRequest,
    public nsIRunnable
{
public:
  NS_DECL_CYCLE_COLLECTING_ISUPPORTS
  NS_DECL_NSICONTENTPERMISSIONREQUEST
  NS_DECL_NSIRUNNABLE
  NS_DECL_CYCLE_COLLECTION_CLASS_AMBIGUOUS(PersistentStoragePermissionRequest,
                                           nsIContentPermissionRequest)

  PersistentStoragePermissionRequest(nsIPrincipal* aPrincipal,
                           nsPIDOMWindowInner* aWindow, Promise* aPromise)
    : mPrincipal(aPrincipal), mWindow(aWindow),
      mPermission(PersistentStoragePermission::Prompt),
      mPromise(aPromise)
  {
    MOZ_ASSERT(aPromise);
    mRequester = new nsContentPermissionRequester(mWindow);
  }

protected:
  virtual ~PersistentStoragePermissionRequest() {}

  nsresult ResolvePromise();
  nsresult DispatchResolvePromise();
  nsCOMPtr<nsIPrincipal> mPrincipal;
  nsCOMPtr<nsPIDOMWindowInner> mWindow;
  PersistentStoragePermission mPermission;
  RefPtr<Promise> mPromise;
  nsCOMPtr<nsIContentPermissionRequester> mRequester;
};

NS_IMPL_CYCLE_COLLECTION(PersistentStoragePermissionRequest, mWindow, mPromise)

NS_INTERFACE_MAP_BEGIN_CYCLE_COLLECTION(PersistentStoragePermissionRequest)
  NS_INTERFACE_MAP_ENTRY(nsIContentPermissionRequest)
  NS_INTERFACE_MAP_ENTRY(nsIRunnable)
  NS_INTERFACE_MAP_ENTRY_AMBIGUOUS(nsISupports, nsIContentPermissionRequest)
NS_INTERFACE_MAP_END

NS_IMPL_CYCLE_COLLECTING_ADDREF(PersistentStoragePermissionRequest)
NS_IMPL_CYCLE_COLLECTING_RELEASE(PersistentStoragePermissionRequest)

NS_IMETHODIMP
PersistentStoragePermissionRequest::Run()
{
  if (nsContentUtils::IsSystemPrincipal(mPrincipal)) {
    mPermission = PersistentStoragePermission::Granted;
  } else {
    // File are automatically granted permission.
    nsCOMPtr<nsIURI> uri;
    mPrincipal->GetURI(getter_AddRefs(uri));

    if (uri) {
      bool isFile;
      uri->SchemeIs("file", &isFile);
      if (isFile) {
        mPermission = PersistentStoragePermission::Granted;
      }
    }
  }

  // Grant permission if pref'ed on.
  if (Preferences::GetBool("storage.prompt.testing", false)) {
    if (Preferences::GetBool("storage.prompt.testing.allow", true)) {
      mPermission = PersistentStoragePermission::Granted;
    } else {
      mPermission = PersistentStoragePermission::Denied;
    }
  }

  if (mPermission != PersistentStoragePermission::Prompt) {
    return DispatchResolvePromise();
  }

  return nsContentPermissionUtils::AskPermission(this, mWindow);
}

NS_IMETHODIMP
PersistentStoragePermissionRequest::GetPrincipal(nsIPrincipal** aRequestingPrincipal)
{
  NS_ADDREF(*aRequestingPrincipal = mPrincipal);
  return NS_OK;
}

NS_IMETHODIMP
PersistentStoragePermissionRequest::GetWindow(mozIDOMWindow** aRequestingWindow)
{
  NS_ADDREF(*aRequestingWindow = mWindow);
  return NS_OK;
}

NS_IMETHODIMP
PersistentStoragePermissionRequest::GetElement(nsIDOMElement** aElement)
{
  NS_ENSURE_ARG_POINTER(aElement);
  *aElement = nullptr;
  return NS_OK;
}

NS_IMETHODIMP
PersistentStoragePermissionRequest::Cancel()
{
  // `Cancel` is called if the user denied permission or dismissed the
  // permission request. To distinguish between the two, we set the
  // permission to "default" and query the permission manager in
  // `ResolvePromise`.
  mPermission = PersistentStoragePermission::Prompt;
  return DispatchResolvePromise();
}

NS_IMETHODIMP
PersistentStoragePermissionRequest::Allow(JS::HandleValue aChoices)
{
  MOZ_ASSERT(aChoices.isUndefined());

  mPermission = PersistentStoragePermission::Granted;

  return DispatchResolvePromise();
}

NS_IMETHODIMP
PersistentStoragePermissionRequest::GetRequester(nsIContentPermissionRequester** aRequester)
{
  NS_ENSURE_ARG_POINTER(aRequester);

  nsCOMPtr<nsIContentPermissionRequester> requester = mRequester;
  requester.forget(aRequester);

  return NS_OK;
}

inline nsresult
PersistentStoragePermissionRequest::DispatchResolvePromise()
{
  return NS_DispatchToMainThread(NewRunnableMethod(this,
           &PersistentStoragePermissionRequest::ResolvePromise));
}

nsresult
PersistentStoragePermissionRequest::ResolvePromise()
{
  nsresult rv = NS_OK;
  if (mPermission == PersistentStoragePermission::Prompt) {
    // This will still be "default" if the user dismissed the doorhanger,
    // or "denied" otherwise.
    // XXX
    //mPermission = Notification::TestPermission(mPrincipal);
  }

  mPromise->MaybeResolve(mPermission);
  return rv;
}

NS_IMETHODIMP
PersistentStoragePermissionRequest::GetTypes(nsIArray** aTypes)
{
  nsTArray<nsString> emptyOptions;

  return nsContentPermissionUtils::CreatePermissionArray(NS_LITERAL_CSTRING("persistent-storage"),
                                                         NS_LITERAL_CSTRING("unused"),
                                                         emptyOptions,
                                                         aTypes);
}

/*******************************************************************************
 * StorageManager
 ******************************************************************************/

StorageManager::StorageManager(nsIGlobalObject* aGlobal)
  : mOwner(aGlobal)
{
  MOZ_ASSERT(aGlobal);
}

StorageManager::~StorageManager()
{
}

already_AddRefed<Promise>
StorageManager::Estimate(ErrorResult& aRv)
{
  MOZ_ASSERT(mOwner);

  RefPtr<Promise> promise = Promise::Create(mOwner, aRv);
  if (NS_WARN_IF(!promise)) {
    return nullptr;
  }

  if (NS_IsMainThread()) {
    nsCOMPtr<nsPIDOMWindowInner> window = do_QueryInterface(mOwner);
    if (NS_WARN_IF(!window)) {
      aRv.Throw(NS_ERROR_FAILURE);
      return nullptr;
    }

    nsCOMPtr<nsIDocument> doc = window->GetExtantDoc();
    if (NS_WARN_IF(!doc)) {
      aRv.Throw(NS_ERROR_FAILURE);
      return nullptr;
    }

    nsCOMPtr<nsIPrincipal> principal = doc->NodePrincipal();
    MOZ_ASSERT(principal);

    RefPtr<EstimateResolver> resolver = new EstimateResolver(promise);

    RefPtr<nsIQuotaUsageRequest> request;
    nsresult rv =
      GetUsageForPrincipal(principal, resolver, getter_AddRefs(request));
    if (NS_WARN_IF(NS_FAILED(rv))) {
      aRv.Throw(rv);
      return nullptr;
    }

    return promise.forget();
  }

  WorkerPrivate* workerPrivate = GetCurrentThreadWorkerPrivate();
  MOZ_ASSERT(workerPrivate);

  RefPtr<PromiseWorkerProxy> promiseProxy =
    PromiseWorkerProxy::Create(workerPrivate, promise);
  if (NS_WARN_IF(!promiseProxy)) {
    return nullptr;
  }

  RefPtr<EstimateWorkerMainThreadRunnable> runnnable =
    new EstimateWorkerMainThreadRunnable(promiseProxy->GetWorkerPrivate(),
                                         promiseProxy);

  runnnable->Dispatch(aRv);
  if (NS_WARN_IF(aRv.Failed())) {
    return nullptr;
  }

  return promise.forget();
}

// static
bool
StorageManager::PrefEnabled(JSContext* aCx, JSObject* aObj)
{
  if (NS_IsMainThread()) {
    return Preferences::GetBool("dom.storageManager.enabled");
  }

  WorkerPrivate* workerPrivate = GetWorkerPrivateFromContext(aCx);
  MOZ_ASSERT(workerPrivate);

  return workerPrivate->StorageManagerEnabled();
}

already_AddRefed<Promise>
StorageManager::Persist(ErrorResult& aRv)
{
  RefPtr<Promise> promise = Promise::Create(mOwner, aRv);
  if (NS_WARN_IF(!promise)) {
    return nullptr;
  }

  if (NS_IsMainThread()) {
    nsCOMPtr<nsPIDOMWindowInner> window = do_QueryInterface(mOwner);

    if (NS_WARN_IF(!window)) {
      aRv.Throw(NS_ERROR_FAILURE);
      return nullptr;
    }

    nsCOMPtr<nsIDocument> doc = window->GetExtantDoc();
    if (NS_WARN_IF(!doc)) {
      aRv.Throw(NS_ERROR_FAILURE);
      return nullptr;
    }

    nsCOMPtr<nsIPrincipal> principal = doc->NodePrincipal();
    MOZ_ASSERT(principal);

    nsCOMPtr<nsIRunnable> request =
      new PersistentStoragePermissionRequest(principal,
                                             window,
                                             promise);

    NS_DispatchToMainThread(request);
    return promise.forget();
  }

  WorkerPrivate* workerPrivate = GetCurrentThreadWorkerPrivate();
  MOZ_ASSERT(workerPrivate);

  RefPtr<PromiseWorkerProxy> promiseProxy =
    PromiseWorkerProxy::Create(workerPrivate, promise);
  if (NS_WARN_IF(!promiseProxy)) {
    return nullptr;
  }

  RefPtr<EstimateWorkerMainThreadRunnable> runnnable =
    new EstimateWorkerMainThreadRunnable(promiseProxy->GetWorkerPrivate(),
                                         promiseProxy);

  runnnable->Dispatch(aRv);
  if (NS_WARN_IF(aRv.Failed())) {
    return nullptr;
  }

  return promise.forget();
}

NS_IMPL_CYCLE_COLLECTION_WRAPPERCACHE(StorageManager, mOwner)

NS_IMPL_CYCLE_COLLECTING_ADDREF(StorageManager)
NS_IMPL_CYCLE_COLLECTING_RELEASE(StorageManager)

NS_INTERFACE_MAP_BEGIN_CYCLE_COLLECTION(StorageManager)
  NS_WRAPPERCACHE_INTERFACE_MAP_ENTRY
  NS_INTERFACE_MAP_ENTRY(nsISupports)
NS_INTERFACE_MAP_END

JSObject*
StorageManager::WrapObject(JSContext* aCx,
                           JS::Handle<JSObject*> aGivenProto)
{
  return StorageManagerBinding::Wrap(aCx, this, aGivenProto);
}

} // namespace dom
} // namespace mozilla
