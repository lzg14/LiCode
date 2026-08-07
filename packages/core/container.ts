/**
 * 轻量依赖注入容器
 *
 * 提供按 key 注册服务工厂 + 惰性单例解析。不引入重量级 DI 框架。
 *
 * 关键设计：
 * - factory 惰性执行（首次 resolve 才实例化单例），避免注册阶段就构建依赖图
 * - 单例缓存（singleton=true）在首次 resolve 后缓存实例
 */
export type ServiceFactory<T> = () => T

export class Container {
  private factories = new Map<string, ServiceFactory<unknown>>()
  private singletons = new Map<string, unknown>()

  register<T>(key: string, factory: ServiceFactory<T>): void {
    // 覆盖注册时清掉已缓存的单例实例，确保后续 resolve 用新工厂
    this.singletons.delete(key)
    this.factories.set(key, factory as ServiceFactory<unknown>)
  }

  resolve<T>(key: string): T {
    if (this.singletons.has(key)) return this.singletons.get(key) as T
    const factory = this.factories.get(key)
    if (!factory) throw new Error(`Service not registered: ${key}`)
    const instance = factory()
    this.singletons.set(key, instance)
    return instance as T
  }

  has(key: string): boolean {
    return this.factories.has(key) || this.singletons.has(key)
  }
}