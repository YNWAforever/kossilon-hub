import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const folder=import.meta.dirname,read=n=>JSON.parse(readFileSync(join(folder,n),'utf8')),save=(n,v)=>writeFileSync(join(folder,n),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const p=read('ap00-prefilled.json');
p.verified_local.historical_checks.receipt_paths_resolve_from='../cosec-20261025-build-d29cd5ec/';
writeFileSync(join(folder,'ap00-prefilled.json'),JSON.stringify(p,null,2)+'\n');
const deferred={
 storage_account_and_bucket_id:['AP-04/AP-09','Storage target needed before document bytes/uploads; not metadata-only'],
 approved_object_prefix:['AP-04/AP-12','Exact keys/prefix needed before object writes/cleanup'],
 scanner_sandbox_id:['AP-09','Real provider binding needed before scan calls'],
 approved_calendar_version_hash_and_expected_dates:['AP-07/UC134','Requires owner-approved business calendar/expected dates'],
 fixture_driver_diff_and_physical_row_budget:['AP-02/AP-06/AP-08','Proposed budgets already prefilled; native driver/diff still pending'],
 actual_fixture_ids_and_versions:['AP-02 onward','No fixture needed for metadata/identity-only; exact IDs before business use'],
 cleanup_manifest_and_disposition:['AP-12','Initial proposal retains data, closes own sessions only; no deletion/disposal'],
 fault_clone_id:['AP-07','No clone creation or shared-target fault permission'],
 fault_runtime_url_and_artifact_binding:['AP-07','Separate fault environment; not Core preflight'],
 backup_id_and_restore_target:['AP-11','No backup/restore in first scope'],
 restore_runtime_url_and_artifact_binding:['AP-11','Separate restore environment; no implicit deploy'],
 scheduler_owner_runtime_and_allowed_job_ids:['AP-11','Exact owned jobs before scheduler observation/side effects'],
 provider_destinations_models_cost_and_receipt_contracts:['AP-09','Calls/spend0 until separate destination/corpus/model/cost approval'],
 physical_device_browser_and_network_profile:['AP-10','Not needed for identity/metadata preflight']
};
const bindings=Object.keys(p.observed_native_bindings).map(field=>{
 let stage='AP-01_METADATA_OR_IDENTITY_AFTER_EXPLICIT_APPROVAL',responsibility='Agent records from approved metadata/secure access; owner may supply authoritative links/IDs',reason='Local source/artifact cannot establish actual native target identity';
 if(['environment_owner','existing_isolated_url'].includes(field)){stage='MINIMUM_GROUP_1';responsibility='Owner provides';reason='No existing approved isolated target in local evidence';}
 if(field==='role_identity_manifest'){stage='MINIMUM_GROUP_2_ADMIN_ACCESS_THEN_ROLE_SPECIFIC_PACKETS';reason='Existing QA Admin first; other20 aliases remain deferred; no account/profile/role creation';}
 if(deferred[field]){stage='DEFERRED_'+deferred[field][0];responsibility='Owner plus agent at that packet, not required now';reason=deferred[field][1];}
 return{field,status:'UNVERIFIED_NATIVE_VALUE_REMAINS_NULL',actual_value:null,stage,responsibility,reason};
});
assert.equal(bindings.length,31);assert.equal(bindings.filter(b=>b.stage.startsWith('DEFERRED_')).length,14);
save('binding-register.json',{purpose:'Routes31 unverified native fields; not31 immediate user questions',total_fields:31,immediate_owner_fields:['environment_owner','existing_isolated_url'],initial_admin_access_requirement:'Existing QA account identifier and safe access method only; immutable IDs to be verified after explicit approval; no passwords/tokens in chat',deferred_fields:14,fields:bindings,all_native_values_unverified:true});
save('minimum-input-template.json',{status:'PREPARATION_ONLY_NO_EXECUTION_APPROVAL',source_sha:p.expected_native.source_sha,environment:{existing_nonproduction_url:null,owner:null,dedicated_or_shared:null,authoritative_resource_metadata_links_or_ids:null,existing_safe_access_location:null,no_environment_answer_allowed:'No isolated environment; remains blocked; no resource creation implied'},qa_access:{existing_QA_admin_identifier:null,secure_login_or_existing_session_method:null,db_readonly_access_reference_if_available:null,if_unavailable:'Metadata-only may be proposed; authenticated/DB scope stays blocked; no account creation or magic-link send'},data:{needed_for_metadata_identity_only:false,existing_business_ids:null,ask_only_before_business_scope:'Exact accessible/inaccessible company/case IDs, roles and versions; Core fixtures/storage/provider requirements remain deferred'},future_permission:{current:'Preparation only',requested_subscope:null,valid_hkt_from:null,valid_hkt_until:null,approver:null,proposed_limits_reference:'ap00-prefilled.json#proposed_not_approved.first_scope',accepted_limits:null,approved:false},secrets_in_chat:false});
console.log('Verified local / proposed / unverified native fields separated;14 native fields deferred.');
